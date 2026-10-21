import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { COMPANY_THEMES, activeThemeIds, type CompanyThemeId } from '../company-themes/model';
import { hash } from '../research/publisher';
import { candidateId, parsePublication, publicationPlan, RelationshipReviewError } from './service';
import { REVIEW_TYPES, type PublicationInput } from './model';
import { AUTO_POLICY_VERSION, validateAutomaticClaim } from './validation';

type Row = Record<string, unknown>;
const names = (d: Row) => [...new Set([d.name, d.legalName, ...(Array.isArray(d.aliases) ? d.aliases : []), ...Object.values((d.names ?? {}) as Row)].filter((n): n is string => typeof n === 'string' && n.trim().length >= 3))];
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function themes(d: Row): CompanyThemeId[] {
  const ids = activeThemeIds(d).filter(t => COMPANY_THEMES.includes(t as CompanyThemeId)) as CompanyThemeId[];
  if (!(d.themeMemberships as Row | undefined)?.ai && (d.inGraph as Row | undefined)?.status === 'PUBLISHED') ids.push('ai');
  return [...new Set(ids)];
}
/** Run after observation + original source have committed. No extra AI calls. */
export async function autoPublishRelationship(db: Firestore, id: string, at = new Date().toISOString()) {
  try {
    candidateId(id);
    return await db.runTransaction(async tx => {
      const ref = db.collection('company_relationships').doc(id), snapshot = await tx.get(ref), d = snapshot.data();
      if (!d || d.status !== 'NEEDS_REVIEW') return { published: false, reasons: ['Already processed or unavailable'] };
      if (!['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(String(d.recordKind))) return { published: false, reasons: ['Unsupported observation kind'] };
      const filing = d.recordKind === 'FILING_OBSERVATION';
      let sourceId = String(d.source ?? ''), targetId = String(d.target ?? '');
      if (filing) {
        const matches = await Promise.all(['name', 'legalName', 'aliases'].map(field => tx.get(db.collection('companies').where(field, field === 'aliases' ? 'array-contains' : '==', d.targetName).limit(3))));
        const ids = [...new Set(matches.flatMap(p => p.docs).filter(doc => ['PUBLISHED', 'DIRECTORY'].includes(String(doc.data().status)) && names(doc.data()).some(n => normalize(n) === normalize(String(d.targetName)))).map(doc => doc.id))];
        targetId = ids.length === 1 ? ids[0] : '';
        if (d.direction === 'target_to_source') [sourceId, targetId] = [targetId, sourceId];
      }
      if (!sourceId || !targetId) return { published: false, reasons: ['Unresolved company identity'] };
      const docs = await tx.getAll(...[sourceId, targetId].map(key => db.collection('companies').doc(key)));
      if (docs.some(doc => !doc.exists || !['PUBLISHED', 'DIRECTORY'].includes(String(doc.data()?.status)))) return { published: false, reasons: ['Company unavailable'] };
      const ev = (Array.isArray(d.evidence) ? d.evidence : []) as Row[];
      let quote = String(ev[0]?.summary ?? ''), state = String(d.commercialStatus ?? 'DOCUMENTED');
      if (filing) {
        const section = (await tx.get(db.collection('sec_filing_sections').doc(`${d.accessionNumber}_${d.section}`))).data();
        if (!section || !normalize(String(section.text ?? '')).includes(normalize(quote)) || !quote.trim()) return { published: false, reasons: ['Original filing quotation unavailable'] };
        // A filing's first-person subject is its issuer; do not replace arbitrary pronouns in news.
        quote = quote.replace(/\b(?:we|our|the company)\b/gi, String(d.sourceName));
        state = /\b(?:will|plan(?:s|ned)? to|intend(?:s)? to|expect(?:s)? to)\b/i.test(quote) ? 'ANNOUNCED' : state;
      }
      const type = String(filing ? d.relationshipType : d.type) as PublicationInput['type'];
      if (!REVIEW_TYPES.includes(type)) return { published: false, reasons: ['Unsupported relationship type'] };
      const eligibility = validateAutomaticClaim({ source: { id: sourceId, names: names(docs[0].data()!), themes: themes(docs[0].data()!) }, target: { id: targetId, names: names(docs[1].data()!), themes: themes(docs[1].data()!) }, type, state, quote, confidence: Number(d.confidence), category: d.targetType === 'category', eventDate: d.eventDate, date: at.slice(0, 10) });
      if (!eligibility.eligible) return { published: false, reasons: eligibility.errors };
      const input = parsePublication({ candidateId: id, version: hash(d), sourceId, targetId, type, state: state as PublicationInput['state'], themeIds: eligibility.themeIds, summary: String(ev[0]?.summary ?? '').slice(0, 1200), limitation: 'AI-extracted claim from the cited source; not independently verified by the community. Scope and timing are limited to the quotation.', note: `Automatic validation policy ${AUTO_POLICY_VERSION}`, evidenceConfirmed: true, eventDate: d.eventDate ?? null });
      const plan = await publicationPlan(db, tx, input, at, true);
      const auditRef = db.collection('research_batches').doc(`relationship-auto-${hash(id).slice(0, 40)}`);
      const existingAudit = await tx.get(auditRef);
      if (existingAudit.exists) return { published: false, reasons: ['Existing publication audit'] };
      const decision = { decision: 'APPROVED', reviewedBy: 'automatic-policy', reviewedAt: at, note: input.note, auditId: auditRef.id, relationshipId: plan.preview.relationshipId, themeIds: plan.preview.themeIds };
      const record = { kind: 'RELATIONSHIP_AUTO_PUBLICATION', policyVersion: AUTO_POLICY_VERSION, input, decision, candidateBefore: d, before: plan.before, after: plan.after };
      if (Buffer.byteLength(JSON.stringify(record)) > 700_000) throw new RelationshipReviewError(413, 'Publication audit too large');
      tx.set(db.collection('company_relationships').doc(plan.preview.relationshipId), plan.after);
      tx.update(ref, { status: 'APPROVED', relationshipReview: decision, automaticPolicyVersion: AUTO_POLICY_VERSION });
      tx.create(auditRef, record);
      return { published: true, reasons: [], relationshipId: plan.preview.relationshipId };
    });
  } catch (error) {
    if (error instanceof RelationshipReviewError) return { published: false, reasons: [error.message] };
    throw error;
  }
}

/** Bounded, resumable sweep also covers old filing/news candidates and identity resolutions. */
export async function autoPublishPendingRelationships(db: Firestore, deadline: number, limit = 30) {
  const cursorRef = db.collection('collectors').doc('relationship-auto-publication');
  const after = String((await cursorRef.get()).data()?.after ?? '');
  const query = db.collection('company_relationships').where('status', '==', 'NEEDS_REVIEW').orderBy(FieldPath.documentId());
  const page = await (after ? query.startAfter(after) : query).limit(Math.max(1, Math.min(limit, 30))).get();
  let published = 0, scanned = 0, cursor = after;
  for (const doc of page.docs) {
    if (Date.now() + 15_000 >= deadline) break;
    if (['FILING_OBSERVATION', 'NEWS_OBSERVATION'].includes(String(doc.data().recordKind))) {
      const result = await autoPublishRelationship(db, doc.id);
      if (result.published) published++;
      else await db.runTransaction(async tx => {
        const current = await tx.get(doc.ref);
        if (current.data()?.status === 'NEEDS_REVIEW' && hash(current.data()) === hash(doc.data())) tx.update(doc.ref, { automaticValidation: { version: AUTO_POLICY_VERSION, reasons: result.reasons, checkedAt: new Date().toISOString() } });
      });
    }
    cursor = doc.id; scanned++;
  }
  await cursorRef.set({ after: scanned === page.size && page.size < limit ? '' : cursor, checkedAt: new Date().toISOString(), scanned, published }, { merge: true });
  return { scanned, published };
}
