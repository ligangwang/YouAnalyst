import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {processEodBatchedRun, processEodCompanyBatch, eodBatchRequest, parseEodBatchRequest, type EodBatchRequest} from '../../src/lib/predictions/eod-batch-queue';
import {companyWorkRef, companyWorkRequest} from '../../src/lib/company-work-queue';
import type {EodCompanyRunRequest} from '../../src/lib/predictions/eod-company-queue';

function fixture(count = 205) {
  const f = pubsubFirestore();
  const root: EodCompanyRunRequest = {version: 2, type: 'eod.company-run.requested', batchId: 'test-run', requestedAt: '2026-10-31T00:00:00Z', input: {market: 'US', runDate: '2026-10-30'}};
  const ref = f.db.collection('eod_runs').doc('_request_test-run');
  f.rows.set(ref.path, {request: root});
  const ids = Array.from({length: count}, (_, i) => `US:T${String(i).padStart(4, '0')}`);
  const messages: (EodCompanyRunRequest | EodBatchRequest)[] = [];
  const attempts = new Map<string, number>();
  let scores = 0, fail: (id: string, n: number) => boolean = () => false;
  const options = {db: f.db, owner: 'test-worker', plan: async () => ids, prepare: async () => ({}), pause: async () => {},
    publish: async (m: EodCompanyRunRequest | EodBatchRequest) => { messages.push(m); },
    work: async (task: {companyId: string}) => {
      const n = (attempts.get(task.companyId) ?? 0) + 1; attempts.set(task.companyId, n);
      if (fail(task.companyId, n)) throw Error('provider failure');
      return null;
    },
    onVerified: async () => {}, finalize: async () => { scores++; return null; },
  };
  const deliver = (m: EodCompanyRunRequest | EodBatchRequest) => m.type === 'eod.company-batch.requested'
    ? processEodCompanyBatch(m, options) : processEodBatchedRun(m, options);
  const drain = async () => { for (let i = 0; messages.length; i++) { assert.ok(i < 100); await deliver(messages.shift()!); } };
  return {...f, root, ref, ids, options, messages, attempts, deliver, drain, scores: () => scores, fail: (fn: typeof fail) => { fail = fn; }};
}

test('100-company main batches finish before one failed-only retry pass, including duplicates', async () => {
  const f = fixture(); f.fail((id, n) => id !== 'US:T0204' && n === 1);
  const batches: EodBatchRequest[] = [], seen = new Set<string>();
  await f.deliver(f.root);
  for (let i = 0; f.messages.length; i++) {
    assert.ok(i < 100);
    const m = f.messages.shift()!;
    const first=m.type === 'eod.company-batch.requested'&&!seen.has(m.batchId);
    if (first && m.type === 'eod.company-batch.requested') {
      seen.add(m.batchId); batches.push(m);
      if (m.pass === 1) assert.equal(f.attempts.size, 205, 'all main companies attempted before retry');
    }
    await f.deliver(m);
    if (first && m.type === 'eod.company-batch.requested') await f.deliver(m);
  }
  assert.deepEqual(batches.filter(b => b.pass === 0).map(b => b.companyIds.length), [100, 100, 5]);
  assert.deepEqual(batches.filter(b => b.pass === 1).map(b => b.companyIds.length), [100, 100, 4]);
  assert.equal(f.attempts.get('US:T0204'), 1);
  assert.ok([...f.attempts.values()].every(n => n <= 2));
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies, 205);
  assert.equal(f.scores(), 1);
  assert.equal(f.rows.get('eod_runs/_company_pipeline')?.activeRequest, null);
});

test('permanent failures settle after exactly two attempts and withhold finalization', async () => {
  const f = fixture(101); f.fail(id => id === 'US:T0000');
  await f.deliver(f.root); await f.drain();
  assert.equal(f.attempts.get('US:T0000'), 2); assert.equal(f.scores(), 0);
  assert.equal(f.rows.get(f.ref.path)?.status, 'FAILED');
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies, 100);
  const failed = companyWorkRef(f.db, 'eod_runs', companyWorkRequest('eod', f.root, 'US:T0000').batchId);
  assert.equal(f.rows.get(failed.path)?.completed, false);
  await f.deliver(eodBatchRequest(f.root, ['US:T0000'], 1, 0));
  assert.equal(f.attempts.get('US:T0000'), 2);
});

test('publication failures reuse checkpoints and do not consume another application attempt', async () => {
  const f = fixture(2); await f.deliver(f.root);
  const batch = f.messages.shift()!;
  const publish = f.options.publish;
  f.options.publish = async () => { throw Error('publication unavailable'); };
  await assert.rejects(f.deliver(batch), /publication unavailable/);
  assert.equal(f.rows.get(f.ref.path)?.dispatchCursor, 2);
  f.options.publish = publish; await f.deliver(batch); await f.drain();
  assert.deepEqual([...f.attempts.values()], [1, 1]); assert.equal(f.scores(), 1);
});

test('interrupted work is not rerun in the main pass; cleanup has one attempt', async () => {
  const f = fixture(2); await f.deliver(f.root);
  const task = companyWorkRequest('eod', f.root, f.ids[0]), receipt = companyWorkRef(f.db, 'eod_runs', task.batchId);
  f.rows.set(receipt.path, {request: task, result: {}, completed: false, eodAttempt: {pass: 0, state: 'running'}});
  await f.drain();
  assert.equal(f.attempts.get(f.ids[0]), 1, 'only the retry calls work after unknown main outcome');
  assert.equal(f.scores(), 1);
});

test('time budget checkpoints a batch and resumes without repeating settled companies', async () => {
  const f = fixture(3); await f.deliver(f.root);
  const batch = f.messages.shift() as EodBatchRequest;
  await processEodCompanyBatch(batch, {...f.options, budgetMs: 0});
  assert.equal(f.attempts.size, 0); assert.deepEqual(f.messages[0], batch);
  await f.drain(); assert.deepEqual([...f.attempts.values()], [1, 1, 1]);
});

test('prediction pages resume within the same pass and do not count as company retries', async () => {
  const f = fixture(1); let pages = 0;
  await f.deliver(f.root);
  const batch = f.messages.shift() as EodBatchRequest;
  await processEodCompanyBatch(batch, {...f.options, work: async (_task, _parent, _prepared, cursor) => { pages++; return cursor === null ? 'page2' : null; }});
  await f.drain(); assert.equal(pages, 2); assert.equal(f.scores(), 1);
});

test('receipt barrier rejects counter tampering and batches reject forged scopes', async () => {
  const f = fixture(1); await f.deliver(f.root);
  const batch = f.messages.shift() as EodBatchRequest;
  assert.throws(() => parseEodBatchRequest({...batch, companyIds: ['US:FAKE']}), /identity/);
  await assert.rejects(f.deliver(eodBatchRequest(f.root, ['US:FAKE'], 0, 0)), /scope/);
  f.rows.set(f.ref.path, {...f.rows.get(f.ref.path), dispatchCursor: 1, completedCompanies: 1});
  await assert.rejects(f.deliver(f.root), /barrier/); assert.equal(f.scores(), 0);
});

test('immediate batch continuation delivery happens after the parent lease releases', async () => {
  const f = fixture(102);
  f.options.publish = async m => { await f.deliver(m); };
  await f.deliver(f.root);
  assert.equal(f.attempts.size, 102); assert.equal(f.scores(), 1);
});
