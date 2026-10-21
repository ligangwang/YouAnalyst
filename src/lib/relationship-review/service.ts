import { FieldPath, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { COMPANY_THEMES, activeThemeIds, type CompanyThemeId, type ThemedCompany } from '../company-themes/model';
import { canonical, hash, mergeEdge, type ComputeBatch } from '../research/publisher';
import { articleHash } from '../intelligence/collectors/news-analysis';
import { canonicalEvidenceUrl } from '../intelligence/model';
import { REVIEW_TYPES, type PublicationInput, type ReviewCandidate, type ReviewCompany, type ReviewDecision, type ReviewDetail, type ReviewEvidence, type ReviewPreview, type ReviewStatus } from './model';

type Row = Record<string, unknown>;
export class RelationshipReviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new RelationshipReviewError(status, message); };
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown) => typeof v === 'string' ? v : '';
const companyId = (v: unknown): v is string => typeof v === 'string' && /^(US:[A-Z0-9.-]{1,30}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const normalized = (v: string) => v.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function candidateId(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !/^(news:[a-f0-9]{64}|filing:[A-Za-z0-9_.:-]{1,250})$/.test(v)) fail(400, 'Invalid candidate ID');
}
function https(v: unknown) {
  try { const u = new URL(str(v)); return u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 2000 ? u.href : ''; }
  catch { return ''; }
}
function evidence(data: Row): ReviewEvidence[] {
  return (Array.isArray(data.evidence) ? data.evidence : []).map(row).slice(0, 20).map(e => ({
    url: https(e.url), title: str(e.title), quote: str(e.summary) || str(data.evidenceText),
    sourceDate: date(e.sourceDate) ? e.sourceDate : null,
  }));
}
function observation(id: string, data: Row): ReviewCandidate {
  if (!['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(str(data.recordKind))) fail(404, 'Relationship candidate unavailable');
  if (!['NEEDS_REVIEW', 'APPROVED', 'REJECTED'].includes(str(data.status))) fail(409, 'This record is outside the review queue');
  const filing = data.recordKind === 'FILING_OBSERVATION';
  return {
    id, version: hash(data), kind: data.recordKind as ReviewCandidate['kind'], status: data.status as ReviewStatus,
    sourceName: str(data.sourceName) || str(data.source), targetName: str(data.targetName) || str(data.target),
    sourceId: companyId(data.source) ? data.source : '', targetId: companyId(data.target) ? data.target : '',
    type: str(filing ? data.relationshipType : data.type), state: data.commercialStatus === 'ANNOUNCED' || data.commercialStatus === 'TERMINATED' ? data.commercialStatus : 'DOCUMENTED',
    summary: str(data.summary) || str(data.evidenceText), createdAt: str(data.createdAt), evidence: evidence(data),
    direction: filing ? str(data.direction) : 'source_to_target', category: data.targetType === 'category',
    eventDate: date(data.eventDate) ? data.eventDate : null,
    decision: data.relationshipReview ? data.relationshipReview as ReviewDecision : null,
    ...(Array.isArray(row(data.automaticValidation).reasons) ? { automaticValidation: { reasons: (row(data.automaticValidation).reasons as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 20), checkedAt: str(row(data.automaticValidation).checkedAt) } } : {}),
  };
}
function company(id: string, data: Row): ReviewCompany {
  if (!['PUBLISHED', 'DIRECTORY'].includes(str(data.status)) || !str(data.name).trim()) fail(409, `Company ${id} is unavailable`);
  const themes = activeThemeIds(data as ThemedCompany).filter(t => COMPANY_THEMES.includes(t as CompanyThemeId)) as CompanyThemeId[];
  if (!row(data.themeMemberships).ai && row(data.inGraph).status === 'PUBLISHED') themes.push('ai');
  return { id, name: str(data.name), legalName: str(data.legalName) || str(data.name), themes: [...new Set(themes)] };
}
export async function listReviewCandidates(db: Firestore, status = 'NEEDS_REVIEW', after = '') {
  if (!['NEEDS_REVIEW', 'APPROVED', 'REJECTED'].includes(status)) fail(400, 'Invalid review status');
  if (after && (after.length > 512 || /[/\p{Cc}]/u.test(after))) fail(400, 'Invalid cursor');
  const query = db.collection('company_relationships').where('status', '==', status).orderBy(FieldPath.documentId());
  const page = await (after ? query.startAfter(after) : query).limit(30).get();
  const items = page.docs.filter(d => ['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(str(d.data().recordKind)))
    .map(d => observation(d.id, d.data()));
  // Cursor follows the scanned page, including records not owned by this queue.
  return { items, nextCursor: page.size === 30 ? page.docs.at(-1)!.id : null };
}
export async function getReviewCompany(db: Firestore, id: string) {
  if (!companyId(id)) fail(400, 'Invalid company ID');
  return company(id, (await db.collection('companies').doc(id).get()).data() ?? {});
}
async function sourceContext(db: Firestore, tx: Transaction, data: Row) {
  if (data.recordKind !== 'NEWS_OBSERVATION') return { sourceText: null, sourceWarning: 'Open the original filing to verify the quotation and its context.', fingerprint: hash(evidence(data)) };
  if (!/^news_analysis_[a-f0-9]{64}$/.test(str(data.analysisReceiptId)) || !/^company_news_[a-f0-9]{64}$/.test(str(data.sourceEventId))) fail(409, 'Original analysis reference is missing');
  const receipt = (await tx.get(db.collection('events').doc(str(data.analysisReceiptId)))).data() ?? {};
  const source = (await tx.get(db.collection('events').doc(str(data.sourceEventId)))).data() ?? {};
  const text = str(receipt.content), quote = evidence(data)[0];
  if (receipt.type !== 'news_analysis' || receipt.status !== 'complete' || !text || text.length > 60_000
    || articleHash(text) !== data.contentHash || receipt.contentHash !== data.contentHash
    || receipt.sourceEventId !== data.sourceEventId || source.type !== 'company_news'
    || source.sourceType !== 'company_ir' || receipt.title !== source.title
    || canonicalEvidenceUrl(str(source.url)) !== receipt.sourceUrl || !quote
    || canonicalEvidenceUrl(quote.url) !== receipt.sourceUrl || !quote.quote.trim()
    || !normalized(text).includes(normalized(quote.quote))) fail(409, 'Original article or evidence changed; resolve the source before publishing');
  return { sourceText: text, sourceWarning: null, fingerprint: hash({ contentHash: receipt.contentHash, url: receipt.sourceUrl, title: receipt.title }) };
}
export async function getReviewCandidate(db: Firestore, id: string): Promise<ReviewDetail> {
  candidateId(id);
  return db.runTransaction(async tx => {
    const data = (await tx.get(db.collection('company_relationships').doc(id))).data();
    if (!data) fail(404, 'Candidate not found');
    const candidate = observation(id, data!);
    const ids = [...new Set([candidate.sourceId, candidate.targetId].filter(Boolean))];
    const docs = ids.length ? await tx.getAll(...ids.map(id => db.collection('companies').doc(id))) : [];
    const companies = docs.flatMap(d => { try { return [company(d.id, d.data() ?? {})]; } catch { return []; } });
    let context: Pick<ReviewDetail, 'sourceText' | 'sourceWarning'>;
    try { context = await sourceContext(db, tx, data!); }
    catch (error) { if (!(error instanceof RelationshipReviewError)) throw error; context = { sourceText: null, sourceWarning: error.message }; }
    return { candidate, companies, sourceText: context.sourceText, sourceWarning: context.sourceWarning };
  }, { readOnly: true });
}
export function parsePublication(raw: unknown): PublicationInput {
  const d = row(raw);
  const keys = ['candidateId', 'version', 'sourceId', 'targetId', 'type', 'state', 'themeIds', 'summary', 'limitation', 'note', 'evidenceConfirmed', 'eventDate'];
  candidateId(d.candidateId);
  if (Object.keys(d).some(k => !keys.includes(k)) || !/^[a-f0-9]{64}$/.test(str(d.version))
    || !companyId(d.sourceId) || !companyId(d.targetId) || d.sourceId === d.targetId
    || !REVIEW_TYPES.includes(d.type as PublicationInput['type']) || !['DOCUMENTED', 'ANNOUNCED', 'TERMINATED'].includes(str(d.state))
    || !Array.isArray(d.themeIds) || !d.themeIds.length || d.themeIds.length > 3
    || new Set(d.themeIds).size !== d.themeIds.length || !d.themeIds.every(t => COMPANY_THEMES.includes(t))
    || d.evidenceConfirmed !== true
    || d.eventDate !== undefined && d.eventDate !== null && !date(d.eventDate)) fail(400, 'Confirm distinct companies, relationship type, evidence, date and at least one theme');
  for (const key of ['summary', 'limitation', 'note']) if (typeof d[key] !== 'string' || !str(d[key]).trim() || str(d[key]).length > 1200) fail(400, 'Summary, limitations and review note are required (maximum 1,200 characters each)');
  if (d.type === 'PLANNED_ADOPTER_OF' && d.state !== 'ANNOUNCED') fail(400, 'Planned adoption must remain announced');
  return { ...d, summary: str(d.summary).trim(), limitation: str(d.limitation).trim(), note: str(d.note).trim(), themeIds: [...d.themeIds as CompanyThemeId[]].sort() } as PublicationInput;
}
const auditId = (id: string) => `relationship-review-${hash(id).slice(0, 40)}`;

export async function publicationPlan(db: Firestore, tx: Transaction, input: PublicationInput, at: string, automated = false) {
  const candidateRef = db.collection('company_relationships').doc(input.candidateId);
  const data = (await tx.get(candidateRef)).data();
  if (!data) fail(404, 'Candidate not found');
  const candidate = observation(input.candidateId, data!);
  if (candidate.status !== 'NEEDS_REVIEW' || candidate.version !== input.version) fail(409, 'Candidate changed or was already reviewed; reload it');
  if (candidate.category) fail(400, 'Unnamed categories cannot be published as company relationships');
  const eventDate = input.eventDate === undefined ? candidate.eventDate : input.eventDate;
  if (eventDate && eventDate > at.slice(0, 10) && input.state !== 'ANNOUNCED') fail(400, 'Future event dates must remain announced');
  if (!candidate.evidence.length || candidate.evidence.some(e => !e.url || !e.title.trim() || e.title.length > 500 || !e.quote.trim() || e.quote.length > 20_000 || e.sourceDate && e.sourceDate > at.slice(0, 10))) fail(409, 'Candidate needs valid source evidence before publication');
  const context = await sourceContext(db, tx, data!);
  const docs = await tx.getAll(...[input.sourceId, input.targetId].map(id => db.collection('companies').doc(id)));
  const endpoints = docs.map(d => company(d.id, d.data() ?? {}));
  for (const theme of input.themeIds) if (endpoints.some(c => !c.themes.includes(theme))) fail(409, `Both companies must have published ${theme} memberships before publishing to that theme`);
  const n = canonical(input.sourceId, input.targetId, input.type);
  // Read bounded endpoint neighborhoods so reversed legacy keys cannot create a duplicate.
  const pages = await Promise.all([input.sourceId, input.targetId].map(id => tx.get(db.collection('company_relationships').where('source', '==', id).limit(501))));
  if (pages.some(p => p.size > 500)) fail(409, 'Company has too many relationships for this bounded review; use the research publication workflow');
  const matches = [...new Map(pages.flatMap(p => p.docs).map(d => [d.id, d])).values()].filter(d => {
    const r = d.data();
    return !['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(str(r.recordKind)) && canonical(str(r.source), str(r.target), str(r.type)).id === n.id;
  });
  if (matches.length > 1) fail(409, 'Duplicate published relationships require reconciliation before approval');
  const existing = matches[0] ?? await tx.get(db.collection('company_relationships').doc(n.id));
  const before = existing.exists ? existing.data()! : null;
  if (automated && before && (before.communityOpenCount || before.communityReviewedAt || before.publicationOrigin !== 'AI')) fail(409, 'Existing editorial or community decision requires review');
  if (before && (before.status !== 'PUBLISHED' || canonical(str(before.source), str(before.target), str(before.type)).id !== n.id || ['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(str(before.recordKind)))) fail(409, 'Existing relationship has a conflicting identity or editorial decision');
  const id = existing.exists ? existing.id : n.id;
  const retainedThemes = before ? (Array.isArray(before.themeIds) ? before.themeIds.filter((t: unknown) => COMPANY_THEMES.includes(t as CompanyThemeId)) : ['ai']) as CompanyThemeId[] : [];
  const themes = [...new Set([...retainedThemes, ...input.themeIds])].sort() as CompanyThemeId[];
  const batch: ComputeBatch = {
    batchId: automated ? `relationship-auto-${hash(input.candidateId).slice(0, 40)}` : auditId(input.candidateId), asOf: at.slice(0, 10),
    sources: candidate.evidence.map((e, i) => ({ id: `evidence-${i}`, url: e.url, title: e.title, summary: e.quote, sourceDate: e.sourceDate, retrievedAt: at.slice(0, 10) })),
    relationships: [{ source: n.source, target: n.target, type: n.type, facts: [{
      state: input.state === 'ANNOUNCED' ? 'ANNOUNCED' : 'DOCUMENTED', scope: input.summary,
      sourceIds: candidate.evidence.map((_, i) => `evidence-${i}`), limitation: input.limitation,
      verificationStatus: automated ? 'PENDING' : input.state === 'TERMINATED' ? 'TERMINATED' : input.state === 'ANNOUNCED' ? 'PENDING' : 'CONFIRMED',
      ...(eventDate ? { eventDate } : {}),
    }] }],
  };
  // The admin policy validates all extraction types; the existing external batch API keeps its narrower allowlist.
  const after = { ...mergeEdge(batch, batch.relationships[0], before), id, themeIds: themes,
    publicationOrigin: automated ? 'AI' : 'EDITORIAL',
    topic: before?.topic ?? themes.join(', '), researchReviewedAt: at, commercialStatus: input.state,
    researchBatchIds: [...new Set([...(Array.isArray(before?.researchBatchIds) ? before.researchBatchIds : []), batch.batchId])],
    ...(before ? {} : { publishedAt: at }),
  };
  const f = batch.relationships[0].facts[0];
  const factId = hash([f.verificationStatus, f.eventDate ?? null, f.state, f.scope, f.limitation, batch.sources.map(s => s.url).sort()]);
  const unreviewedId = hash([f.state, f.scope, f.limitation, batch.sources.map(s => s.url).sort()]);
  after.researchFacts = (after.researchFacts ?? []).map(fact =>
    (fact.id === factId || !f.eventDate && fact.id === unreviewedId && fact.verificationStatus === f.verificationStatus)
      ? { ...fact, reviewedAt: at } : fact);
  const preview: ReviewPreview = {
    token: hash({ input, before, source: context.fingerprint, companies: docs.map(d => d.data()), day: at.slice(0, 10) }),
    relationshipId: id, source: endpoints.find(c => c.id === n.source)!, target: endpoints.find(c => c.id === n.target)!,
    type: n.type, state: input.state, summary: input.summary, limitation: input.limitation,
    themeIds: themes, retainedThemes, existing: Boolean(before), evidenceCount: after.evidence?.length ?? 0, factCount: after.researchFacts.length, eventDate,
  };
  return { preview, before, after, data: data!, candidateRef };
}
export async function previewRelationship(db: Firestore, raw: unknown, at = new Date().toISOString()) {
  const input = parsePublication(raw);
  return db.runTransaction(async tx => (await publicationPlan(db, tx, input, at)).preview, { readOnly: true });
}
export async function approveRelationship(db: Firestore, raw: unknown, token: string, uid: string, at = new Date().toISOString()) {
  const input = parsePublication(raw);
  if (!/^[a-f0-9]{64}$/.test(token)) fail(400, 'Preview the publication first');
  const requestHash = hash({ input, token, uid });
  return db.runTransaction(async tx => {
    const auditRef = db.collection('research_batches').doc(auditId(input.candidateId));
    const audit = (await tx.get(auditRef)).data();
    if (audit) { if (audit.requestHash === requestHash) return audit.decision as ReviewDecision; fail(409, 'Candidate already reviewed; reload it'); }
    const plan = await publicationPlan(db, tx, input, at);
    if (plan.preview.token !== token) fail(409, 'Publication preview is stale; preview the current evidence and relationship again');
    const decision: ReviewDecision = { decision: 'APPROVED', reviewedBy: uid, reviewedAt: at, note: input.note, auditId: auditRef.id, relationshipId: plan.preview.relationshipId, themeIds: plan.preview.themeIds };
    const record = { kind: 'RELATIONSHIP_REVIEW', requestHash, input, decision, candidateBefore: plan.data, before: plan.before, after: plan.after };
    if (Buffer.byteLength(JSON.stringify(record)) > 700_000) fail(413, 'Relationship audit is too large; use a smaller research batch');
    tx.set(db.collection('company_relationships').doc(plan.preview.relationshipId), plan.after);
    tx.update(plan.candidateRef, { status: 'APPROVED', relationshipReview: decision });
    tx.create(auditRef, record);
    return decision;
  });
}
export async function rejectRelationship(db: Firestore, raw: unknown, uid: string, at = new Date().toISOString()) {
  const d = row(raw); candidateId(d.candidateId);
  if (Object.keys(d).some(k => !['candidateId', 'version', 'note'].includes(k)) || !/^[a-f0-9]{64}$/.test(str(d.version)) || !str(d.note).trim() || str(d.note).length > 1200) fail(400, 'A current candidate and rejection reason are required');
  const id = d.candidateId, requestHash = hash({ input: d, uid });
  return db.runTransaction(async tx => {
    const ref = db.collection('company_relationships').doc(id), auditRef = db.collection('research_batches').doc(auditId(id));
    const audit = (await tx.get(auditRef)).data();
    if (audit) { if (audit.requestHash === requestHash) return audit.decision as ReviewDecision; fail(409, 'Candidate already reviewed; reload it'); }
    const data = (await tx.get(ref)).data(); if (!data) fail(404, 'Candidate not found');
    const candidate = observation(id, data!);
    if (candidate.status !== 'NEEDS_REVIEW' || candidate.version !== d.version) fail(409, 'Candidate changed or was already reviewed; reload it');
    const decision: ReviewDecision = { decision: 'REJECTED', reviewedBy: uid, reviewedAt: at, note: str(d.note).trim(), auditId: auditRef.id, relationshipId: null, themeIds: [] };
    const record = { kind: 'RELATIONSHIP_REVIEW', requestHash, decision, candidateBefore: data };
    if (Buffer.byteLength(JSON.stringify(record)) > 700_000) fail(413, 'Candidate is too large to audit');
    tx.update(ref, { status: 'REJECTED', relationshipReview: decision }); tx.create(auditRef, record);
    return decision;
  });
}
