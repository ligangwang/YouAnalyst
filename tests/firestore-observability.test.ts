/* eslint-disable @typescript-eslint/no-explicit-any -- SDK-compatible test doubles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { observeFirestore, type FirestoreOperationLog } from '../src/lib/firebase/firestore-observability';

function fixture() {
  const logs: FirestoreOperationLog[] = [];
  let calls = 0, fail = false;
  class Ref {
    constructor(public path: string) {}
    async get() { calls++; if (fail) throw Object.assign(new Error('SECRET'), { code: 14 }); return snap(this); }
    async update() { calls++; if (fail) throw Object.assign(new Error('SECRET'), { code: 14 }); return { writeTime: 'now' }; }
    collection(name: string) { return new Query(`${this.path}/${name}`); }
  }
  const snap = (ref: Ref) => ({ exists: !ref.path.endsWith('/missing'), ref, data: () => ({ secret: 'PRIVATE CONTENT' }) });
  class Query {
    constructor(public path: string) {}
    where() { return new Query(this.path); }
    limit() { return new Query(this.path); }
    startAfter(value: any) { assert.equal(value.ref instanceof Ref, true); return this; }
    doc(id: string) { return new Ref(`${this.path}/${id}`); }
    count() { return { get: async () => { calls++; return { data: () => ({ count: 12345 }) }; } }; }
    async get() { calls++; const docs = [snap(this.doc('secret-id')), snap(this.doc('other'))]; return { docs, size: docs.length, forEach: (fn: any) => docs.forEach(fn) }; }
  }
  class Batch {
    set(ref: Ref) { assert(ref instanceof Ref); return this; }
    update(ref: Ref) { assert(ref instanceof Ref); return this; }
    async commit() { calls++; if (fail) throw Object.assign(new Error('SECRET'), { code: 14 }); return []; }
  }
  const raw = {
    collection: (name: string) => new Query(name),
    doc: (path: string) => new Ref(path),
    batch: () => new Batch(),
    async getAll(...refs: Ref[]) { calls++; return refs.map(snap); },
    async runTransaction(work: any) {
      let result;
      for (let i = 0; i < 2; i++) result = await work({ get: (ref: any) => ref.get(), set: () => undefined });
      if (fail) throw Object.assign(new Error('SECRET'), { code: 10 });
      return result;
    },
  };
  const db = observeFirestore(raw as unknown as Firestore, entry => logs.push(entry));
  return { db, logs, raw, calls: () => calls, fail: () => { fail = true; } };
}

test('query reads, snapshot refs, cursors and getAll stay observable without extra reads or private data', async () => {
  const f = fixture();
  const query = f.db.collection('companies').where('themeIds', 'array-contains-any', ['secret-filter']).limit(100);
  const result = await query.get();
  assert.equal(f.calls(), 1);
  assert.equal(f.logs[0].documentsReturned, 2);
  assert.equal(f.logs[0].billableReads, null);
  assert.match(String(f.logs[0].queryShape), /themeIds array-contains-any \?/);
  await result.docs[0].ref.update({ name: 'PRIVATE CONTENT' });
  assert.equal(f.logs[1].documentsWritten, 1);
  await query.startAfter(result.docs[0]).get();
  await f.db.getAll(f.db.doc('companies/secret-id'), f.db.doc('companies/missing'));
  assert.equal(f.logs[3].documentsReturned, 1);
  assert.equal(f.logs[3].documentsMissing, 1);
  assert.equal(f.logs[3].documentsRequested, 2);
  assert.equal(f.calls(), 4);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret-filter|secret-id|PRIVATE CONTENT/);
  assert.equal(observeFirestore(f.raw as unknown as Firestore), f.db);
  assert.equal(observeFirestore(f.db), f.db);
});

test('batches only count committed writes, grouped by collection and operation', async () => {
  const f = fixture(), batch = f.db.batch();
  batch.set(f.db.doc('companies/a'), { private: true }).set(f.db.doc('companies/b'), {});
  batch.update(f.db.doc('users/private-id/preferences/a'), { private: true });
  assert.equal(f.logs.length, 0);
  await batch.commit();
  assert.equal(f.calls(), 1);
  assert.equal(f.logs.reduce((sum, log) => sum + Number(log.documentsWritten ?? 0), 0), 3);
  assert(f.logs.some(log => log.collection === 'users/*/preferences'));
  const failed = fixture();
  failed.db.batch().set(failed.db.doc('companies/a'), {});
  const bad = failed.db.batch().set(failed.db.doc('companies/b'), {});
  failed.fail();
  await assert.rejects(bad.commit());
  assert.equal(failed.logs[0].status, 'error');
  assert.equal(failed.logs[0].documentsWritten, null);
});

test('transaction retries count every read attempt but only final committed writes', async () => {
  const f = fixture();
  const result = await f.db.runTransaction(async tx => {
    await tx.get(f.db.doc('companies/a'));
    tx.set(f.db.doc('companies/a'), { secret: true });
    return 42;
  });
  assert.equal(result, 42);
  const reads = f.logs.filter(row => row.operation === 'get');
  assert.deepEqual(reads.map(row => row.transactionAttempt), [1, 2]);
  assert.equal(f.logs.filter(row => row.documentsWritten === 1).length, 1);
  assert.equal(f.logs.at(-1)?.attempts, 2);
  assert.equal(f.calls(), 2);
});

test('transaction queries preserve shape and failed transactions claim no successful writes', async () => {
  const f = fixture();
  await f.db.runTransaction(async tx => {
    await tx.get(f.db.collection('companies').where('themeIds', 'array-contains', 'secret'));
  });
  assert(f.logs.filter(row => row.operation === 'get').every(row => row.documentsReturned === 2 && row.collection === 'companies'));
  const failed = fixture(); failed.fail();
  await assert.rejects(failed.db.runTransaction(async tx => { tx.set(failed.db.doc('companies/a'), {}); }));
  assert.equal(failed.logs.length, 1);
  assert.equal(failed.logs[0].documentsWritten, null);
});

test('aggregates never confuse result count with scanned or billed documents', async () => {
  const f = fixture();
  const result = await f.db.collection('companies').count().get();
  assert.equal(result.data().count, 12345);
  assert.equal(f.logs[0].operation, 'aggregate');
  assert.equal(f.logs[0].documentsReturned, 0);
  assert.equal(f.logs[0].billableReads, null);
  assert.equal(f.calls(), 1);
});

test('failures propagate unchanged and logging failures cannot fail database operations', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.db.doc('companies/private-id').get(), /SECRET/);
  assert.equal(f.logs[0].errorCode, 14);
  assert.doesNotMatch(JSON.stringify(f.logs), /SECRET|private-id/);
  const other = fixture();
  const db = observeFirestore({ ...other.raw } as unknown as Firestore, () => { throw new Error('logging unavailable'); });
  assert.equal((await db.collection('companies').get()).size, 2);
});

test('wrapped references preserve real SDK identity, batches and equality without network access', () => {
  const raw = new Firestore({ projectId: 'observability-test' });
  const db = observeFirestore(raw, () => {});
  const ref = db.doc('companies/US:NVDA');
  assert(ref.isEqual(raw.doc('companies/US:NVDA')));
  assert(ref.isEqual(db.doc('companies/US:NVDA')));
  assert.equal(ref.firestore, db);
  assert.equal(ref.parent.path, 'companies');
  const batch = db.batch();
  assert.equal(batch.set(ref, { test: true }), batch);
  assert.equal(batch.update(ref, { test: false }), batch);
  const query = db.collection('companies').where('themeIds', 'array-contains', 'ai').where('exchange_region', '==', 'US').limit(10);
  assert(query.isEqual(raw.collection('companies').where('themeIds', 'array-contains', 'ai').where('exchange_region', '==', 'US').limit(10)));
});
