import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { approveRelationship, getReviewCandidate, listReviewCandidates, parsePublication, previewRelationship, rejectRelationship } from '../../src/lib/relationship-review/service';
import { relationshipReviewResponse } from '../../src/lib/relationship-review/http';
import type { PublicationInput } from '../../src/lib/relationship-review/model';
import { articleHash } from '../../src/lib/intelligence/collectors/news-analysis';
import { canonical, processBatch } from '../../src/lib/research/publisher';
import { relationshipBelongsToTheme } from '../../src/lib/knowledge-graph/relationship-cache';
import { graphFromMarket, type MarketCompany, type MarketRelationship } from '../../src/lib/knowledge-graph/market-store';
import { persistEdges } from '../../src/lib/company-graph/service';
import type { CompanyGraphEdge } from '../../src/lib/company-graph/types';

type Row = Record<string, unknown>;

test('source event dates survive publication, graph projection, and repeated evidence', async () => {
  for (const eventDate of ['2026-10-17', '2027-01-01']) {
    const f = fixture();
    f.state.get('company_relationships/' + id)!.eventDate = eventDate;
    const detail = await getReviewCandidate(f.db, id);
    assert.equal(detail.candidate.eventDate, eventDate);
    const body = await input(f), p = await previewRelationship(f.db, body, at);
    assert.equal(p.eventDate, eventDate);
    await approveRelationship(f.db, body, p.token, 'admin', at);
    const record = f.state.get('company_relationships/' + p.relationshipId)!;
    const companies = ['US:AMD', 'US:ANET'].map(id => ({ ...f.state.get('companies/' + id), id, inGraph: { status: 'PUBLISHED', stageIds: [], stages: [], memberships: [], sources: [], order: 0, asOf: '2026-10-20' } } as MarketCompany));
    const graph = graphFromMarket(companies, [record as MarketRelationship]);
    assert.equal(graph.relationships.find(e => e.id === p.relationshipId)!.facts![0].eventDate, eventDate);
    assert.equal((record.researchFacts as Row[])[0].reviewedAt, at);
    const secondId = 'news:' + articleHash('same-event');
    f.state.set('company_relationships/' + secondId, { ...fixture().state.get('company_relationships/' + id), eventDate });
    const second = await input(f, secondId), next = await previewRelationship(f.db, second, at);
    assert.equal(next.factCount, 1);
  }
});

test('event date corrections are reviewed and unknown dates never become source publication dates', async () => {
  const f = fixture();
  f.state.get('company_relationships/' + id)!.eventDate = '2026-10-17';
  const body = await input(f);
  await assert.rejects(previewRelationship(f.db, { ...body, eventDate: '2026-02-30' }, at));
  await assert.rejects(previewRelationship(f.db, { ...body, eventDate: '2027-01-01', state: 'DOCUMENTED' }, at), /Future event/);
  const p = await previewRelationship(f.db, { ...body, eventDate: '2026-10-18' }, at);
  await assert.rejects(approveRelationship(f.db, { ...body, eventDate: '2026-10-19' }, p.token, 'admin', at), /stale/);
  assert.equal(f.writes(), 0);
  const unknown = { ...body, eventDate: null }, preview = await previewRelationship(f.db, unknown, at);
  assert.equal(preview.eventDate, null);
  await approveRelationship(f.db, unknown, preview.token, 'admin', at);
  assert.equal((f.state.get('company_relationships/' + preview.relationshipId)!.researchFacts as Row[])[0].eventDate, undefined);
});


test('published observations coexist with later research batches and repeated evidence stays deduplicated', async () => {
  const f = fixture(), body = await input(f), p = await previewRelationship(f.db, body, at);
  await approveRelationship(f.db, body, p.token, 'admin', at);
  const secondId = 'news:' + articleHash('second');
  const original = fixture().state.get('company_relationships/' + id)!;
  f.state.set('company_relationships/' + secondId, original);
  const second = await input(f, secondId), p2 = await previewRelationship(f.db, second, at);
  assert.equal(p2.existing, true); assert.equal(p2.evidenceCount, 1); assert.equal(p2.factCount, 1);
  await approveRelationship(f.db, second, p2.token, 'admin', at);
  const batch = { batchId: 'later-research', asOf: '2026-10-20', sources: [{ id: 'source', url, title: 'Partnership announcement', sourceDate: '2026-10-19', retrievedAt: '2026-10-20' }], relationships: [{ source: 'US:AMD', target: 'US:ANET', type: 'PARTNER_OF', facts: [{ state: 'ANNOUNCED' as const, scope: 'Additional supported scope', sourceIds: ['source'], limitation: 'No confirmed deliveries.' }] }] };
  const before = f.writes(), plan = await processBatch(f.db, batch);
  assert.equal(plan.changes.length, 1); assert.equal(plan.changes[0].id, p.relationshipId);
  assert.equal(f.writes(), before);
  await processBatch(f.db, batch, plan);
  assert.equal((f.state.get('company_relationships/' + p.relationshipId)!.researchFacts as unknown[]).length, 2);
  assert.equal(f.state.get('company_relationships/' + id)!.status, 'APPROVED');
});

const content = 'AMD and Arista announced a networking partnership for robotics systems.';
const receiptId = 'news_analysis_' + articleHash('receipt'), eventId = 'company_news_' + articleHash('event');
const id = 'news:' + articleHash('candidate'), at = '2026-10-20T14:00:00.000Z';
const url = 'https://investors.example.com/partnership';
function fixture() {
  const state = new Map<string, Row>([
    ['companies/US:AMD', { name: 'AMD', status: 'PUBLISHED', themeMemberships: { ai: { status: 'PUBLISHED' }, robotics: { status: 'PUBLISHED' } } }],
    ['companies/US:ANET', { name: 'Arista', status: 'DIRECTORY', themeMemberships: { ai: { status: 'PUBLISHED' }, robotics: { status: 'PUBLISHED' } } }],
    ['company_relationships/' + id, { recordKind: 'NEWS_OBSERVATION', status: 'NEEDS_REVIEW', source: 'US:AMD', target: 'US:ANET', type: 'PARTNER_OF', sourceName: 'AMD', targetName: 'Arista', summary: content, commercialStatus: 'ANNOUNCED', contentHash: articleHash(content), sourceEventId: eventId, analysisReceiptId: receiptId, createdAt: at, evidence: [{ url, title: 'Partnership announcement', sourceDate: '2026-10-19', summary: content }] }],
    ['events/' + eventId, { type: 'company_news', sourceType: 'company_ir', url, title: 'Partnership announcement' }],
    ['events/' + receiptId, { type: 'news_analysis', status: 'complete', content, contentHash: articleHash(content), sourceEventId: eventId, sourceUrl: url, title: 'Partnership announcement' }],
  ]);
  let writes = 0, failCommit = false, queue = Promise.resolve();
  const ref = (collection: string, id: string) => ({ id, path: collection + '/' + id, get: async () => snap(ref(collection, id)) });
  const snap = (r: ReturnType<typeof ref>) => ({ id: r.id, ref: r, exists: state.has(r.path), data: () => structuredClone(state.get(r.path)) });
  function query(name: string, filters: [string, unknown][] = [], after = '', limit = Infinity) {
    return {
      doc: (id: string) => ref(name, id),
      where: (field: string, op: string, value: unknown) => { assert.equal(op, '=='); return query(name, [...filters, [field, value]], after, limit); },
      orderBy: () => query(name, filters, after, limit),
      startAfter: (value: string) => query(name, filters, value, limit),
      limit: (value: number) => query(name, filters, after, value),
      get: async () => {
        const docs = [...state].filter(([p, d]) => p.startsWith(name + '/') && filters.every(([k, v]) => d[k] === v))
          .map(([p]) => snap(ref(name, p.slice(name.length + 1)))).filter(d => d.id > after)
          .sort((a, b) => a.id < b.id ? -1 : 1).slice(0, limit);
        return { docs, size: docs.length };
      },
    };
  }
  const db = { collection: (name: string) => query(name), runTransaction: <T>(fn: (tx: unknown) => Promise<T>, opts?: { readOnly?: boolean }) => {
    const work = queue.then(async () => {
      const pending: { r: ReturnType<typeof ref>; data: Row; merge?: boolean; create?: boolean }[] = [];
      const stage = (r: ReturnType<typeof ref>, data: Row, merge = false, create = false) => { assert(!opts?.readOnly); pending.push({ r, data: structuredClone(data), merge, create }); };
      const result = await fn({
        get: async (q: { get: () => unknown }) => { assert.equal(pending.length, 0, 'Firestore reads must precede writes'); return q.get(); },
        getAll: async (...refs: ReturnType<typeof ref>[]) => { assert.equal(pending.length, 0); return refs.map(snap); },
        set: (r: ReturnType<typeof ref>, d: Row, opts?: { merge?: boolean }) => stage(r, d, opts?.merge),
        update: (r: ReturnType<typeof ref>, d: Row) => { assert(state.has(r.path)); stage(r, d, true); },
        create: (r: ReturnType<typeof ref>, d: Row) => stage(r, d, false, true),
      });
      if (failCommit && pending.length) throw Error('Simulated commit failure');
      for (const p of pending) if (p.create) assert(!state.has(p.r.path));
      for (const p of pending) { state.set(p.r.path, p.merge ? { ...state.get(p.r.path), ...p.data } : p.data); writes++; }
      return result;
    });
    queue = work.then(() => undefined, () => undefined); return work;
  } } as unknown as Firestore;
  return { state, db, writes: () => writes, failCommit: () => { failCommit = true; } };
}
async function input(f: ReturnType<typeof fixture>, candidateId = id): Promise<PublicationInput> {
  const d = await getReviewCandidate(f.db, candidateId);
  return { candidateId, version: d.candidate.version, sourceId: 'US:AMD', targetId: 'US:ANET', type: 'PARTNER_OF', state: 'ANNOUNCED', themeIds: ['robotics'], summary: content, limitation: 'Announcement only; no confirmed deliveries.', note: 'Read source and confirmed both identities.', evidenceConfirmed: true };
}

test('preview writes nothing; approval atomically publishes with evidence, selected themes, and an audit', async () => {
  const f = fixture(), body = await input(f), p = await previewRelationship(f.db, body, at);
  assert.equal(f.writes(), 0); assert.deepEqual(p.themeIds, ['robotics']); assert.equal(p.existing, false);
  const d = await approveRelationship(f.db, body, p.token, 'admin', at);
  assert.equal(f.writes(), 3);
  const edge = f.state.get('company_relationships/' + d.relationshipId)!;
  assert.equal(edge.status, 'PUBLISHED'); assert.deepEqual(edge.themeIds, ['robotics']);
  assert.equal((edge.evidence as Row[])[0].summary, content);
  assert.equal((edge.researchFacts as Row[])[0].verificationStatus, 'PENDING');
  assert.equal((edge.researchFacts as Row[])[0].reviewedAt, at);
  assert.equal(f.state.get('company_relationships/' + id)!.status, 'APPROVED');
  assert.equal(f.state.get('research_batches/' + d.auditId)!.kind, 'RELATIONSHIP_REVIEW');
  assert.deepEqual(await approveRelationship(f.db, body, p.token, 'admin', at), d);
  assert.equal(f.writes(), 3);
  assert.equal((await listReviewCandidates(f.db)).items.length, 0);
  assert.equal((await listReviewCandidates(f.db, 'APPROVED')).items[0].decision!.relationshipId, d.relationshipId);
});

test('existing reversed legacy edge is merged once and keeps its AI theme and original evidence', async () => {
  const f = fixture();
  f.state.set('company_relationships/legacy', { source: 'US:ANET', target: 'US:AMD', type: 'PARTNER_OF', status: 'PUBLISHED', summary: 'Earlier scope', evidence: [{ id: 'old', url: 'https://example.com/old', title: 'Earlier source', sourceDate: null, retrievedAt: '2026-10-01' }] });
  const body = await input(f), p = await previewRelationship(f.db, body, at);
  assert.equal(p.relationshipId, 'legacy'); assert.equal(p.existing, true);
  assert.deepEqual(p.themeIds, ['ai', 'robotics']); assert.equal(p.evidenceCount, 2);
  await approveRelationship(f.db, body, p.token, 'admin', at);
  const edge = f.state.get('company_relationships/legacy')!;
  assert.equal(edge.source, 'US:AMD'); assert.equal((edge.evidence as Row[])[0].id, 'old');
  assert.equal([...f.state.keys()].filter(k => k.startsWith('company_relationships/')).length, 2);
});

test('stale candidate, source, membership or existing edge prevents any writes', async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.state.get('company_relationships/' + id)!.summary = 'edited'; },
    (f: ReturnType<typeof fixture>) => { f.state.get('events/' + receiptId)!.content = 'changed content'; },
    (f: ReturnType<typeof fixture>) => { f.state.get('events/' + eventId)!.title = 'Changed title'; },
    (f: ReturnType<typeof fixture>) => { f.state.get('companies/US:AMD')!.themeMemberships = {}; },
    (f: ReturnType<typeof fixture>) => { f.state.get('companies/US:AMD')!.name = 'Corrected name'; },
    (f: ReturnType<typeof fixture>) => { f.state.set('company_relationships/legacy', { source: 'US:AMD', target: 'US:ANET', type: 'PARTNER_OF', status: 'PUBLISHED', evidence: [] }); },
  ];
  for (const mutate of mutations) {
    const f = fixture(), body = await input(f), p = await previewRelationship(f.db, body, at);
    mutate(f); const before = structuredClone([...f.state]);
    await assert.rejects(approveRelationship(f.db, body, p.token, 'admin', at));
    assert.deepEqual([...f.state], before); assert.equal(f.writes(), 0);
  }
});

test('rejection keeps source and creates no canonical relationship; racing approvals cannot override it', async () => {
  const f = fixture(), body = await input(f), p = await previewRelationship(f.db, body, at);
  const rejection = { candidateId: id, version: body.version, note: 'No commercial relationship supported.' };
  const [reject, approve] = await Promise.allSettled([rejectRelationship(f.db, rejection, 'admin', at), approveRelationship(f.db, body, p.token, 'other-admin', at)]);
  assert.equal(reject.status, 'fulfilled'); assert.equal(approve.status, 'rejected');
  assert.equal(f.writes(), 2); assert.equal([...f.state.keys()].filter(k => k.startsWith('company_relationships/')).length, 1);
  const c = (await getReviewCandidate(f.db, id)).candidate;
  assert.equal(c.status, 'REJECTED'); assert.equal(c.evidence[0].quote, content);
  await rejectRelationship(f.db, rejection, 'admin', at); assert.equal(f.writes(), 2);
  await assert.rejects(rejectRelationship(f.db, { ...rejection, note: 'Changed' }, 'admin', at), /already reviewed/);
});

test('commit failure leaves both queue and graph untouched', async () => {
  const f = fixture(), body = await input(f), p = await previewRelationship(f.db, body, at), before = structuredClone([...f.state]);
  f.failCommit(); await assert.rejects(approveRelationship(f.db, body, p.token, 'admin', at), /commit failure/);
  assert.deepEqual([...f.state], before); assert.equal(f.writes(), 0);
});

test('evidence and theme validation cannot be bypassed by client fields', async () => {
  const f = fixture(), body = await input(f);
  for (const patch of [{ themeIds: ['space'] }, { type: 'PLANNED_ADOPTER_OF', state: 'DOCUMENTED' }, { sourceId: 'US:ANET' }, { evidenceConfirmed: false }, { note: '' }, { themeIds: ['other'] }, { evidence: [{ url: 'https://forged.test' }] }]) {
    await assert.rejects(previewRelationship(f.db, { ...body, ...patch }, at));
  }
  for (const patch of [{ evidence: [] }, { evidence: [{ url: 'javascript:alert(1)', title: 'Source', summary: content }] }, { evidence: [{ url, title: 'Source', summary: 'Invented quote' }] }]) {
    const fx = fixture(); Object.assign(fx.state.get('company_relationships/' + id)!, patch);
    await assert.rejects(previewRelationship(fx.db, await input(fx), at)); assert.equal(fx.writes(), 0);
  }
  assert.throws(() => parsePublication({ ...body, candidateId: '../other' }), /Invalid/);
});

test('filing review resolves the endpoint and canonicalizes customers without publishing categories', async () => {
  const f = fixture(), filing = 'filing:AMD_123_abc';
  f.state.set('company_relationships/' + filing, { recordKind: 'FILING_OBSERVATION', status: 'NEEDS_REVIEW', source: 'US:AMD', sourceName: 'AMD', targetName: 'Arista', targetType: 'company', relationshipType: 'CUSTOMER_OF', direction: 'source_to_target', evidenceText: 'We buy networking equipment from Arista.', evidence: [{ url: 'https://www.sec.gov/Archives/example.htm', title: 'AMD 10-K', sourceDate: '2026-10-01' }] });
  const detail = await getReviewCandidate(f.db, filing);
  assert.match(detail.sourceWarning!, /original filing/); assert.equal(detail.candidate.targetId, '');
  const body = { ...await input(f, filing), type: 'CUSTOMER_OF' as const, state: 'DOCUMENTED' as const };
  const p = await previewRelationship(f.db, body, at);
  assert.equal(p.source.id, 'US:ANET'); assert.equal(p.target.id, 'US:AMD'); assert.equal(p.type, 'SUPPLIER_OF');
  await approveRelationship(f.db, body, p.token, 'admin', at);
  assert.equal(f.state.get('company_relationships/' + p.relationshipId)!.commercialStatus, 'DOCUMENTED');
  const other = fixture(); other.state.set('company_relationships/' + filing, { ...f.state.get('company_relationships/' + filing), status: 'NEEDS_REVIEW', targetType: 'category' });
  await assert.rejects(previewRelationship(other.db, await input(other, filing), at), /categories/);
});

test('termination is a reviewed fact and explicit theme tags govern AI placement', async () => {
  const f = fixture(), body = { ...await input(f), state: 'TERMINATED' as const }, p = await previewRelationship(f.db, body, at);
  await approveRelationship(f.db, body, p.token, 'admin', at);
  const edge = f.state.get('company_relationships/' + p.relationshipId)!;
  assert.equal(edge.commercialStatus, 'TERMINATED'); assert.equal((edge.researchFacts as Row[])[0].verificationStatus, 'TERMINATED');
  assert.equal(relationshipBelongsToTheme(edge, 'ai'), false);
  assert.equal(relationshipBelongsToTheme(edge, 'robotics'), true);
  assert.equal(relationshipBelongsToTheme({}, 'ai'), true);
  assert.equal(relationshipBelongsToTheme({ themeIds: [] }, 'ai'), false);
});

test('duplicate legacy identities are blocked and extraction retry preserves editorial decisions', async () => {
  const f = fixture(), n = canonical('US:AMD', 'US:ANET', 'PARTNER_OF');
  for (const key of ['one', 'two']) f.state.set('company_relationships/' + key, { ...n, status: 'PUBLISHED' });
  await assert.rejects(previewRelationship(f.db, await input(f), at), /Duplicate/);
  for (const status of ['APPROVED', 'REJECTED']) {
    const key = 'filing:edge-' + status;
    f.state.set('company_relationships/' + key, { status, evidenceText: 'Reviewed evidence' });
    await persistEdges(f.db, [{ id: key.slice(7) } as CompanyGraphEdge], 'https://www.sec.gov/Archives/example.htm');
    assert.deepEqual(f.state.get('company_relationships/' + key), { status, evidenceText: 'Reviewed evidence' });
  }
});

test('page cursors advance through unsupported records and return reviewed history', async () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) f.state.set('company_relationships/a' + String(i).padStart(2, '0'), { status: 'NEEDS_REVIEW' });
  const p = await listReviewCandidates(f.db);
  assert.equal(p.items.length, 0); assert.equal(p.nextCursor, 'a29');
  assert.equal((await listReviewCandidates(f.db, 'NEEDS_REVIEW', p.nextCursor!)).items[0].id, id);
});

test('HTTP requires an admin before reading Firestore and never exposes database errors', async () => {
  for (const actor of [null, { uid: 'user', admin: false }]) for (const method of ['GET', 'POST']) {
    const response = await relationshipReviewResponse(new Request('https://test/api', { method }), { authenticate: async () => actor, db: () => { throw Error('must not read'); } });
    assert.equal(response.status, actor ? 403 : 401); assert.match(response.headers.get('cache-control')!, /no-store/);
  }
  const f = fixture(), deps = { authenticate: async () => ({ uid: 'admin', admin: true }), db: () => f.db };
  const request = (body: string) => new Request('https://test/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await relationshipReviewResponse(request('x'), deps)).status, 400);
  assert.equal((await relationshipReviewResponse(request(' '.repeat(16_001)), deps)).status, 413);
  const fail = await relationshipReviewResponse(new Request('https://test/api'), { ...deps, db: () => { throw Error('secret credential'); } });
  assert.equal(fail.status, 503); assert(!JSON.stringify(await fail.json()).includes('secret'));
  assert.equal(f.writes(), 0);
});

