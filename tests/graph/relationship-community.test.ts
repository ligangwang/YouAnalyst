import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore } from './community-firestore';
import { validateAutomaticClaim } from '../../src/lib/relationship-review/validation';
import { autoPublishPendingRelationships, autoPublishRelationship } from '../../src/lib/relationship-review/automatic';
import { articleHash } from '../../src/lib/intelligence/collectors/news-analysis';
import { canonical, hash } from '../../src/lib/research/publisher';
import { communityRelationship, listContributions, memberContributions, parseContribution, relationshipVersion, resolveContribution, submitContribution } from '../../src/lib/relationship-review/community';
import { communityResponse } from '../../src/lib/relationship-review/community-http';
import type { PublicationInput } from '../../src/lib/relationship-review/model';

const at = '2026-10-20T14:00:00.000Z', quote = 'AMD and Arista collaborate on AI networking for robotics systems.', url = 'https://investors.arista.com/partnership';
const edgeId = canonical('US:AMD', 'US:ANET', 'PARTNER_OF').id, candidate = 'news:' + articleHash('claim'), receipt = 'news_analysis_' + articleHash('receipt'), eventId = 'company_news_' + articleHash('source');
const company = (name: string) => ({ name, status: 'PUBLISHED', themeMemberships: { ai: { status: 'PUBLISHED' }, robotics: { status: 'PUBLISHED' } } });
const edge = () => ({ id: edgeId, source: 'US:AMD', target: 'US:ANET', type: 'PARTNER_OF', summary: quote, commercialStatus: 'DOCUMENTED', status: 'PUBLISHED', publicationOrigin: 'AI', themeIds: ['ai'], evidence: [{ id: 'e', url, title: 'AMD and Arista collaboration', summary: quote, sourceDate: '2026-10-19' }] });
function fixture() { return memoryFirestore([
  ['companies/US:AMD', company('AMD')], ['companies/US:ANET', company('Arista')], ['users/member', { nickname: 'Mira' }], ['users/other', { nickname: 'Other' }], ['company_relationships/' + edgeId, edge()],
  ['company_relationships/' + candidate, { recordKind: 'NEWS_OBSERVATION', status: 'NEEDS_REVIEW', source: 'US:AMD', target: 'US:ANET', type: 'PARTNER_OF', confidence: .97, summary: quote, commercialStatus: 'DOCUMENTED', contentHash: articleHash(quote), sourceEventId: eventId, analysisReceiptId: receipt, evidence: [{ url, title: 'AMD collaboration', sourceDate: '2026-10-19', summary: quote }] }],
  ['events/' + receipt, { type: 'news_analysis', status: 'complete', content: quote, contentHash: articleHash(quote), sourceEventId: eventId, sourceUrl: url, title: 'AMD collaboration' }], ['events/' + eventId, { type: 'company_news', sourceType: 'company_ir', title: 'AMD collaboration', url }],
]); }
const input = (r = edge(), kind = 'DISPUTE') => ({ relationshipId: edgeId, version: relationshipVersion(r), kind, reason: 'The source describes a different relationship.', evidenceUrl: url, evidenceQuote: quote, publicCredit: true });
const policy = (type: PublicationInput['type'], q: string) => validateAutomaticClaim({ source: { id: 'US:AMD', names: ['AMD'], themes: ['ai'] }, target: { id: 'US:ANET', names: ['Arista'], themes: ['ai'] }, type, state: 'DOCUMENTED', quote: q, confidence: .97, category: false, date: at.slice(0, 10) });

test('automatic policy rejects negation, co-mentions, reversed supply, asset acquisitions, missing theme and low confidence', () => {
  assert(policy('PARTNER_OF', quote).eligible);
  for (const [type, q] of [['COMPETES_WITH', 'AMD does not compete with Arista in AI.'], ['PARTNER_OF', 'AMD and Arista use AI chips.'], ['SUPPLIER_OF', 'Arista supplies AI chips to AMD.'], ['ACQUIRES', 'AMD acquired the AI portfolio from Arista.'], ['PARTNER_OF', 'AMD and Arista collaborated formerly in AI.'], ['PARTNER_OF', 'AMD and Arista will collaborate on AI.']] as const) assert.equal(policy(type, q).eligible, false, q);
  assert.equal(policy('PARTNER_OF', 'AMD and Arista collaborate on drug distribution.').eligible, false);
  const base = { source: { id: 'US:AMD', names: ['AMD'], themes: ['ai'] as const }, target: { id: 'US:ANET', names: ['Arista'], themes: ['ai'] as const } };
  for (const patch of [{ confidence: .89 }, { category: true }, { state: 'UNKNOWN' }]) assert.equal(validateAutomaticClaim({ source: { ...base.source, themes: ['ai'] }, target: { ...base.target, themes: ['ai'] }, type: 'PARTNER_OF', quote, state: 'DOCUMENTED', confidence: .97, category: false, date: at.slice(0, 10), ...patch }).eligible, false);
});
test('valid news automatically publishes as provisional, with evidence and idempotent audit', async () => {
  const f = fixture(); f.state.delete('company_relationships/' + edgeId);
  const result = await autoPublishRelationship(f.db, candidate, at); assert(result.published);
  const published = f.state.get('company_relationships/' + edgeId)!;
  assert.equal(published.publicationOrigin, 'AI'); assert.equal(published.status, 'PUBLISHED'); assert.deepEqual(published.themeIds, ['ai', 'robotics']);
  assert.equal((published.researchFacts as { verificationStatus: string }[])[0].verificationStatus, 'PENDING');
  const size = f.state.size; assert.equal((await autoPublishRelationship(f.db, candidate, at)).published, false); assert.equal(f.state.size, size);
});
test('automatic publication preserves editorial decisions and disputed relationships and validates original news', async () => {
  for (const patch of [{ publicationOrigin: 'EDITORIAL' }, { communityOpenCount: 1 }, { communityReviewedAt: at }, { status: 'WITHDRAWN' }]) { const f = fixture(); Object.assign(f.state.get('company_relationships/' + edgeId)!, patch); const before = structuredClone(f.state.get('company_relationships/' + edgeId)); assert.equal((await autoPublishRelationship(f.db, candidate, at)).published, false); assert.deepEqual(f.state.get('company_relationships/' + edgeId), before); }
  const f = fixture(); f.state.get('events/' + receipt)!.content = 'Different source'; assert.equal((await autoPublishRelationship(f.db, candidate, at)).published, false);
});
test('filing publication requires an exact company identity and a stored original quotation', async () => {
  const f = fixture(); f.state.delete('company_relationships/' + edgeId);
  const id = 'filing:example'; f.state.set('company_relationships/' + id, { recordKind: 'FILING_OBSERVATION', status: 'NEEDS_REVIEW', source: 'US:AMD', sourceName: 'AMD', targetName: 'Arista', direction: 'source_to_target', relationshipType: 'PARTNER_OF', confidence: .97, evidenceText: quote, accessionNumber: 'accession', section: 'item1', evidence: [{ url, title: 'AMD 10-K', sourceDate: '2026-10-19', summary: quote }] });
  assert.equal((await autoPublishRelationship(f.db, id, at)).published, false);
  f.state.set('sec_filing_sections/accession_item1', { text: quote }); assert((await autoPublishRelationship(f.db, id, at)).published);
});
test('report submission flags the edge immediately, prevents duplicates and exposes no private identity publicly', async () => {
  const f = fixture(), raw = input(); const a = await submitContribution(f.db, raw, 'member', at); const b = await submitContribution(f.db, raw, 'member', at);
  assert.equal(a.id, b.id); assert(b.duplicate); assert.equal(f.state.get('company_relationships/' + edgeId)!.communityOpenCount, 1);
  const view = await communityRelationship(f.db, edgeId); assert.equal(view.openDisputes, 1); assert(!JSON.stringify(view).includes('member')); assert.deepEqual(view.credits, []);
  assert.equal((await memberContributions(f.db, 'other')).items.length, 0);
});
test('stale/forged submissions and unsupported corrections cannot write', async () => {
  const f = fixture(); await assert.rejects(submitContribution(f.db, { ...input(), version: 'a'.repeat(64) }, 'member', at), /changed/);
  for (const patch of [{ userId: 'other' }, { evidenceUrl: 'javascript:alert(1)' }, { reason: 'short' }, { publicCredit: 'true' }]) assert.throws(() => parseContribution({ ...input(), ...patch }));
  assert.throws(() => parseContribution({ ...input(), kind: 'CORRECTION', correction: { sourceId: 'US:AMD', targetId: 'US:ANET', type: 'PLANNED_ADOPTER_OF', state: 'DOCUMENTED', summary: quote, limitation: quote, themeIds: ['ai'] } }));
});
async function resolve(f: ReturnType<typeof fixture>, id: string, outcome = 'ACCEPTED', admin = 'admin') { const c = f.state.get('relationship_contributions/' + id)!; return resolveContribution(f.db, { id, version: hash(c), outcome, note: 'Original evidence was checked and this finding is supported.', evidenceConfirmed: true }, admin, at); }
test('accepted disputes withdraw the edge and award useful contribution credit exactly once under retries', async () => {
  const f = fixture(), c = await submitContribution(f.db, input(), 'member', at);
  await assert.rejects(resolve(f, c.id, 'ACCEPTED', 'member'), /Another administrator/);
  await Promise.all([resolve(f, c.id), resolve(f, c.id)]);
  assert.equal(f.state.get('company_relationships/' + edgeId)!.status, 'WITHDRAWN'); assert.equal(f.state.get('company_relationships/' + edgeId)!.communityOpenCount, 0);
  assert.deepEqual(f.state.get('users/member')!.relationshipCredit, { points: 10, usefulContributions: 1 }); assert.equal((await memberContributions(f.db, 'member')).items[0].creditedPoints, 10);
});
test('dismissed reports clear their flag without credit or changing relationship evidence', async () => {
  const f = fixture(), c = await submitContribution(f.db, input(), 'member', at); await resolve(f, c.id, 'DISMISSED');
  assert.equal(f.state.get('users/member')!.relationshipCredit, undefined); assert.equal(f.state.get('company_relationships/' + edgeId)!.status, 'PUBLISHED'); assert.equal(f.state.get('company_relationships/' + edgeId)!.communityOpenCount, 0);
});
test('accepted correction publishes the replacement, retains audit, displays opted-in credit and blocks stale reports', async () => {
  const f = fixture(), correction = { sourceId: 'US:ANET', targetId: 'US:AMD', type: 'SUPPLIER_OF', state: 'ANNOUNCED', summary: 'Arista will supply AI networking to AMD.', limitation: 'Future delivery is not confirmed.', themeIds: ['ai'] };
  const a = await submitContribution(f.db, { ...input(), kind: 'CORRECTION', correction }, 'member', at), b = await submitContribution(f.db, input(), 'other', at);
  await resolve(f, a.id); const id = canonical('US:ANET', 'US:AMD', 'SUPPLIER_OF').id;
  const view = await communityRelationship(f.db, id); assert.equal(view.origin, 'COMMUNITY'); assert.equal(view.relationship.state, 'ANNOUNCED'); assert.deepEqual(view.credits, [{ name: 'Mira', points: 10 }]);
  assert(f.state.get('relationship_contributions/' + a.id)!.before); await assert.rejects(resolve(f, b.id), /changed/); assert.equal(f.state.get('users/other')!.relationshipCredit, undefined);
});
test('server enforces daily contribution quota and administrator-only resolution before DB access', async () => {
  const f = fixture(); f.state.get('users/member')!.relationshipContributionQuota = { day: at.slice(0, 10), count: 10 }; await assert.rejects(submitContribution(f.db, input(), 'member', at), /Daily/);
  let reads = 0; const deps = { db: () => { reads++; return f.db; }, authenticate: async () => ({ uid: 'member', admin: false }) };
  assert.equal((await communityResponse(new Request('https://example.test/admin'), deps, true)).status, 403); assert.equal(reads, 0);
  assert.equal((await communityResponse(new Request('https://example.test', { method: 'POST', body: '{}' }), { ...deps, authenticate: async () => null })).status, 401); assert.equal(reads, 0);
  const page = await listContributions(f.db); assert.equal(page.items.length, 0);
});


test('corrections cannot collide with legacy canonical keys or publish outside shared memberships', async () => {
  for (const collision of [true, false]) {
    const f = fixture(), correction = { sourceId: 'US:ANET', targetId: 'US:AMD', type: 'SUPPLIER_OF', state: 'DOCUMENTED', summary: quote, limitation: quote, themeIds: collision ? ['ai'] : ['space'] };
    const c = await submitContribution(f.db, { ...input(), kind: 'CORRECTION', correction }, 'member', at);
    if (collision) f.state.set('company_relationships/legacy-supplier', { ...edge(), source: 'US:ANET', target: 'US:AMD', type: 'SUPPLIER_OF' });
    await assert.rejects(resolve(f, c.id), collision ? /another key/ : /memberships/);
    assert.equal(f.state.get('users/member')!.relationshipCredit, undefined);
    assert.equal(f.state.get('company_relationships/' + edgeId)!.status, 'PUBLISHED');
  }
});

test('private credit preference is honored while useful contributions still earn points', async () => {
  const f = fixture(), correction = { sourceId: 'US:AMD', targetId: 'US:ANET', type: 'PARTNER_OF', state: 'DOCUMENTED', summary: quote, limitation: quote, themeIds: ['ai'] };
  const c = await submitContribution(f.db, { ...input(), publicCredit: false, kind: 'CORRECTION', correction }, 'member', at);
  await resolve(f, c.id);
  assert.deepEqual((await communityRelationship(f.db, edgeId)).credits, []);
  assert.equal((await memberContributions(f.db, 'member')).points, 10);
});

test('HTTP body bounds are enforced before any database access', async () => {
  let reads = 0; const deps = { db: () => { reads++; return fixture().db; }, authenticate: async () => ({ uid: 'member', admin: false }) };
  const response = await communityResponse(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'x'.repeat(16000) }) }), deps);
  assert.equal(response.status, 413); assert.equal(reads, 0);
});


test('scheduled sweep resumes beyond held claims and wraps its cursor without publishing twice', async () => {
  const f = fixture(); f.state.delete('company_relationships/' + edgeId);
  const held = { ...f.state.get('company_relationships/' + candidate)!, confidence: .5 };
  f.state.set('company_relationships/news:' + '0'.repeat(64), held);
  const first = await autoPublishPendingRelationships(f.db, Date.now() + 60000, 1);
  assert.deepEqual(first, { scanned: 1, published: 0 });
  assert(f.state.get('company_relationships/news:' + '0'.repeat(64))!.automaticValidation);
  const second = await autoPublishPendingRelationships(f.db, Date.now() + 60000, 1);
  assert.deepEqual(second, { scanned: 1, published: 1 });
  await autoPublishPendingRelationships(f.db, Date.now() + 60000, 1);
  assert.equal(f.state.get('collectors/relationship-auto-publication')!.after, '');
  assert.equal([...f.state.values()].filter(r => r.kind === 'RELATIONSHIP_AUTO_PUBLICATION').length, 1);
});
