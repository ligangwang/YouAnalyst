import { isThemeId, catalogThemeIds } from '../company-themes/catalog-model';
import { loadThemeCatalog } from '../company-themes/catalog';
import { FieldPath, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { activeThemeIds } from '../company-themes/model';
import { canonical, hash, mergeEdge, type ComputeBatch } from '../research/publisher';
import { REVIEW_TYPES } from './model';
import { RelationshipReviewError } from './service';
import type { ContributionInput, RelationshipContribution, RelationshipCorrection } from './community-model';

export const CONTRIBUTIONS_COLLECTION = 'relationship_contributions';
type Row = Record<string, unknown>;
const fail = (code: number, message: string): never => { throw new RelationshipReviewError(code, message); };
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown, min = 1, max = 1200) => typeof v === 'string' && v.trim().length >= min && v.length <= max ? v.trim() : fail(400, 'Text is missing or too long');
function validId(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[A-Za-z0-9_:.-]{1,300}$/.test(v)) fail(400, 'Invalid relationship ID'); }
const endpoint = (v: unknown) => typeof v === 'string' && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9.-]+)$/.test(v);
function url(v: unknown) { try { const u = new URL(text(v, 8, 2000)); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {} return fail(400, 'An HTTPS evidence link is required'); }
export function relationshipVersion(r: Row) { return hash(Object.fromEntries(['status', 'source', 'target', 'type', 'summary', 'commercialStatus', 'evidence', 'researchFacts', 'themeIds'].map(k => [k, r[k] ?? null]))); }
export function parseCorrection(v: unknown): RelationshipCorrection {
  const d = obj(v);
  if (Object.keys(d).some(k => !['sourceId', 'targetId', 'type', 'state', 'summary', 'limitation', 'themeIds'].includes(k)) || !endpoint(d.sourceId) || !endpoint(d.targetId) || d.sourceId === d.targetId || !REVIEW_TYPES.includes(d.type as RelationshipCorrection['type']) || !['DOCUMENTED', 'ANNOUNCED', 'TERMINATED'].includes(String(d.state)) || !Array.isArray(d.themeIds) || !d.themeIds.length || d.themeIds.length > 30 || new Set(d.themeIds).size !== d.themeIds.length || !d.themeIds.every(t => isThemeId(t))) fail(400, 'Invalid proposed relationship');
  if (d.type === 'PLANNED_ADOPTER_OF' && d.state !== 'ANNOUNCED') fail(400, 'Planned adoption must remain announced');
  return { sourceId: d.sourceId, targetId: d.targetId, type: d.type, state: d.state, summary: text(d.summary), limitation: text(d.limitation), themeIds: [...d.themeIds as RelationshipCorrection['themeIds']].sort() } as RelationshipCorrection;
}
export function parseContribution(v: unknown): ContributionInput {
  const d = obj(v); validId(d.relationshipId);
  if (Object.keys(d).some(k => !['relationshipId', 'version', 'kind', 'reason', 'evidenceUrl', 'evidenceQuote', 'publicCredit', 'correction'].includes(k)) || !/^[a-f0-9]{64}$/.test(String(d.version)) || !['DISPUTE', 'CORRECTION'].includes(String(d.kind)) || typeof d.publicCredit !== 'boolean' || d.kind === 'DISPUTE' && d.correction !== undefined) fail(400, 'Invalid contribution');
  return { relationshipId: d.relationshipId, version: String(d.version), kind: d.kind as ContributionInput['kind'], reason: text(d.reason, 20), evidenceUrl: url(d.evidenceUrl), evidenceQuote: text(d.evidenceQuote, 20, 2000), publicCredit: d.publicCredit as boolean, ...(d.kind === 'CORRECTION' ? { correction: parseCorrection(d.correction) } : {}) };
}
async function published(db: Firestore, tx: Transaction, id: string) {
  validId(id);
  const direct = await tx.get(db.collection('company_relationships').doc(id));
  if (direct.exists) { if (direct.data()?.status !== 'PUBLISHED' || ['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(String(direct.data()?.recordKind))) fail(404, 'Published relationship unavailable'); return direct; }
  // Public graph projections normalize old document keys. Resolve those keys without creating a second edge.
  const parts = id.split('__');
  if (parts.length !== 3 || !endpoint(parts[0]) || !endpoint(parts[2])) fail(404, 'Published relationship unavailable');
  const pages = await Promise.all([parts[0], parts[2]].map(source => tx.get(db.collection('company_relationships').where('source', '==', source).limit(501))));
  if (pages.some(p => p.size > 500)) fail(409, 'Relationship neighborhood requires operator review');
  const matches = [...new Map(pages.flatMap(p => p.docs).map(doc => [doc.id, doc])).values()].filter(doc => { const r = doc.data(); return r.status === 'PUBLISHED' && !['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(String(r.recordKind)) && canonical(String(r.source), String(r.target), String(r.type)).id === id; });
  if (matches.length !== 1) fail(404, 'Published relationship unavailable');
  return matches[0];
}
export async function communityRelationship(db: Firestore, id: string) {
  return db.runTransaction(async tx => {
    const doc = await published(db, tx, id), r = doc.data()!;
    return { relationshipId: doc.id, version: relationshipVersion(r), origin: r.publicationOrigin ?? 'EDITORIAL', openDisputes: Number(r.communityOpenCount ?? 0), evidence: (Array.isArray(r.evidence) ? r.evidence : []).slice(0, 20).filter((e: Row) => typeof e.url === 'string' && e.url.startsWith('https://')).map((e: Row) => ({ url: String(e.url), title: String(e.title ?? 'Source'), quote: String(e.summary ?? '') })), credits: Array.isArray(r.communityCredits) ? r.communityCredits.slice(-10).map((c: Row) => ({ name: String(c.name), points: Number(c.points) })) : [], relationship: { sourceId: String(r.source), targetId: String(r.target), type: String(r.type), state: String(r.commercialStatus ?? 'DOCUMENTED'), summary: String(r.summary ?? ''), limitation: '', themeIds: r.themeIds ?? ['ai'] } };
  }, { readOnly: true });
}
export async function submitContribution(db: Firestore, raw: unknown, uid: string, at = new Date().toISOString()) {
  const input = parseContribution(raw);
  if(input.correction){const allowed=new Set(catalogThemeIds(await loadThemeCatalog(db)));if(input.correction.themeIds.some(id=>!allowed.has(id)))fail(400,'Unknown or unpublished theme');}
  return db.runTransaction(async tx => {
    const edge = await published(db, tx, input.relationshipId), r = edge.data()!;
    if (relationshipVersion(r) !== input.version) fail(409, 'Relationship changed. Reload its evidence before submitting.');
    const id = hash([uid, edge.id, input.version]), ref = db.collection(CONTRIBUTIONS_COLLECTION).doc(id);
    const old = await tx.get(ref);
    if (old.exists) return { id, status: old.data()!.status, duplicate: true };
    const userRef = db.collection('users').doc(uid), profile = (await tx.get(userRef)).data();
    if (!profile) fail(403, 'Complete your member profile before contributing');
    const day = at.slice(0, 10), quota = obj(profile!.relationshipContributionQuota);
    const count = quota.day === day ? Number(quota.count ?? 0) : 0;
    if (count >= 10) fail(429, 'Daily contribution limit reached. Try again tomorrow.');
    if (Number(r.communityOpenCount ?? 0) >= 100) fail(429, 'This relationship already has enough reports for review');
    const creditName = String(profile!.nickname || profile!.displayName || 'Community member').slice(0, 80);
    const contribution = { ...input, relationshipId: edge.id, id, userId: uid, creditName, status: 'OPEN', createdAt: at, relationshipSnapshot: r, version: input.version };
    if (Buffer.byteLength(JSON.stringify(contribution)) > 700_000) fail(413, 'Relationship evidence is too large');
    tx.create(ref, contribution);
    tx.update(edge.ref, { communityOpenCount: Number(r.communityOpenCount ?? 0) + 1 });
    tx.update(userRef, { relationshipContributionQuota: { day, count: count + 1 } });
    return { id, status: 'OPEN', duplicate: false };
  });
}
export async function listContributions(db: Firestore, after = '', status = 'OPEN') {
  if (after && !/^[a-f0-9]{64}$/.test(after) || !['OPEN', 'ACCEPTED', 'DISMISSED'].includes(status)) fail(400, 'Invalid review filter');
  const query = db.collection(CONTRIBUTIONS_COLLECTION).where('status', '==', status).orderBy(FieldPath.documentId());
  const page = await (after ? query.startAfter(after) : query).limit(30).get();
  return { items: page.docs.map(doc => ({ ...doc.data(), id: doc.id, reviewVersion: hash(doc.data()) })), nextCursor: page.size === 30 ? page.docs.at(-1)!.id : null };
}
export async function memberContributions(db: Firestore, uid: string) {
  const [profile, page] = await Promise.all([db.collection('users').doc(uid).get(), db.collection(CONTRIBUTIONS_COLLECTION).where('userId', '==', uid).limit(100).get()]);
  const credit = obj(profile.data()?.relationshipCredit);
  return { points: Number(credit.points ?? 0), usefulContributions: Number(credit.usefulContributions ?? 0), items: page.docs.map(doc => { const r = doc.data(); return { id: doc.id, relationshipId: r.relationshipId, kind: r.kind, reason: r.reason, status: r.status, createdAt: r.createdAt, resolution: r.resolution ?? null, creditedPoints: r.creditedPoints ?? 0 }; }) };
}
export async function resolveContribution(db: Firestore, raw: unknown, admin: string, at = new Date().toISOString()) {
  const d = obj(raw);
  if (Object.keys(d).some(k => !['id', 'version', 'outcome', 'note', 'evidenceConfirmed'].includes(k)) || !/^[a-f0-9]{64}$/.test(String(d.id)) || !/^[a-f0-9]{64}$/.test(String(d.version)) || !['ACCEPTED', 'DISMISSED'].includes(String(d.outcome)) || d.evidenceConfirmed !== true) fail(400, 'Confirm the evidence and review decision');
  const note = text(d.note, 10);
  return db.runTransaction(async tx => {
    const ref = db.collection(CONTRIBUTIONS_COLLECTION).doc(String(d.id)), snapshot = await tx.get(ref), c = snapshot.data() as RelationshipContribution | undefined;
    if (!c) fail(404, 'Contribution unavailable');
    if (c!.userId === admin) fail(403, 'Another administrator must review your contribution');
    if (c!.status !== 'OPEN') return { status: c!.status, creditedPoints: c!.creditedPoints ?? 0 };
    if (hash(c) !== d.version) fail(409, 'Contribution changed. Reload the review queue.');
    const edgeRef = db.collection('company_relationships').doc(c!.relationshipId), edge = await tx.get(edgeRef), r = edge.data();
    if (!r) fail(409, 'Relationship unavailable');
    const accepted = d.outcome === 'ACCEPTED';
    if (accepted && (r!.status !== 'PUBLISHED' || relationshipVersion(r!) !== c!.version)) fail(409, 'Relationship changed. Dismiss this stale report or request a new contribution.');
    const userRef = db.collection('users').doc(c!.userId), profile = (await tx.get(userRef)).data();
    let replacement: Row | null = null, replacementId = edge.id;
    if (accepted && c!.kind === 'CORRECTION') {
      const correction = parseCorrection(c!.correction), n = canonical(correction.sourceId, correction.targetId, correction.type);
      const endpoints = await tx.getAll(...[n.source, n.target].map(id => db.collection('companies').doc(id)));
      for (const company of endpoints) {
        const data = company.data() ?? {};
        if (!data || !['PUBLISHED', 'DIRECTORY'].includes(String(data.status))) fail(409, 'Correction company unavailable');
        const memberships = activeThemeIds(data);
        if (!(data.themeMemberships as Row | undefined)?.ai && (data.inGraph as Row | undefined)?.status === 'PUBLISHED') memberships.push('ai');
        if (correction.themeIds.some(t => !memberships.includes(t))) fail(409, 'Both companies need the proposed theme memberships');
      }
      replacementId = canonical(String(r!.source), String(r!.target), String(r!.type)).id === n.id ? edge.id : n.id;
      const target = replacementId === edge.id ? edge : await tx.get(db.collection('company_relationships').doc(replacementId));
      if (replacementId !== edge.id && target.exists) fail(409, 'Corrected relationship already exists; reconcile it before accepting');
      const neighborhoods = await Promise.all([n.source, n.target].map(source => tx.get(db.collection('company_relationships').where('source', '==', source).limit(501))));
      if (neighborhoods.some(page => page.size > 500)) fail(409, 'Correction requires reconciliation of a large company neighborhood');
      if (neighborhoods.flatMap(page => page.docs).some(doc => { const row = doc.data(); return doc.id !== edge.id && !['NEWS_OBSERVATION', 'FILING_OBSERVATION'].includes(String(row.recordKind)) && canonical(String(row.source), String(row.target), String(row.type)).id === n.id; })) fail(409, 'Corrected relationship already exists under another key; reconcile before accepting');
      const batch: ComputeBatch = { batchId: `community-${c!.id}`, asOf: at.slice(0, 10), sources: [{ id: 'evidence', url: c!.evidenceUrl, title: 'Community correction evidence', summary: c!.evidenceQuote, sourceDate: null, retrievedAt: at.slice(0, 10) }], relationships: [{ ...n, facts: [{ state: correction.state === 'ANNOUNCED' ? 'ANNOUNCED' : 'DOCUMENTED', verificationStatus: correction.state === 'TERMINATED' ? 'TERMINATED' : correction.state === 'ANNOUNCED' ? 'PENDING' : 'CONFIRMED', scope: correction.summary, limitation: correction.limitation, sourceIds: ['evidence'] }] }] };
      const allowed=new Set(catalogThemeIds(await loadThemeCatalog(db)));
      if(correction.themeIds.some(id=>!allowed.has(id)))fail(409,'Proposed theme is no longer published');
      replacement = { ...mergeEdge(batch, batch.relationships[0], null), id: replacementId, themeIds: correction.themeIds, commercialStatus: correction.state, publicationOrigin: 'COMMUNITY', communityReviewedAt: at, correctionEvidenceQuote: c!.evidenceQuote };
    }
    const points = accepted && profile ? 10 : 0;
    const credit = points && c!.publicCredit ? [{ name: c!.creditName, points }] : [];
    const open = Math.max(0, Number(r!.communityOpenCount ?? 0) - 1);
    const after: Row = replacement ? { ...replacement, communityOpenCount: replacementId === edge.id ? open : 0, communityCredits: [...(Array.isArray(r!.communityCredits) ? r!.communityCredits : []), ...credit].slice(-20) } : { ...r!, communityOpenCount: open, ...(accepted ? { status: 'WITHDRAWN', communityReviewedAt: at } : {}) };
    const resolution = { status: String(d.outcome), reviewedAt: at, reviewedBy: admin, resolution: note, creditedPoints: points, resultingRelationshipId: replacementId, before: r!, after };
    if (Buffer.byteLength(JSON.stringify({ ...c, ...resolution })) > 900_000) fail(413, 'Resolution audit too large');
    // Credit and the reviewed publication are committed together, and only once.
    if (replacementId !== edge.id) tx.update(edgeRef, { status: 'WITHDRAWN', communityOpenCount: open, communityReviewedAt: at });
    tx.set(db.collection('company_relationships').doc(replacementId), after);
    tx.update(ref, resolution);
    if (points) { const credit = obj(profile!.relationshipCredit); tx.update(userRef, { relationshipCredit: { points: Number(credit.points ?? 0) + points, usefulContributions: Number(credit.usefulContributions ?? 0) + 1 } }); }
    return { status: String(d.outcome), creditedPoints: points };
  });
}
