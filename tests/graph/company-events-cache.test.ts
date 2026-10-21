import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCompanyEventSnapshot } from '../../src/lib/events/company-events-cache';
import { closeLocalCaches } from '../../src/lib/local-cache/watch';

test('company events share loads, receive changes and remain bounded', async t => {
  t.after(closeLocalCaches);
  const listeners = new Map<string, (snapshot: unknown) => void>();
  let opens = 0;
  const query = (id = '') => ({
    id,
    isEqual(other: { id: string }) { return id === other.id; },
    where(field: string, op: string, value: string) {
      assert.equal(field, 'companyId'); assert.equal(op, '=='); return query(value);
    },
    orderBy(field: string, direction: string) {
      assert.equal(field, 'publication_date'); assert.equal(direction, 'desc'); return this;
    },
    limit(count: number) { assert.equal(count, 30); return this; },
    get: async () => { throw Error('Unexpected repeated query'); },
    onSnapshot(next: (snapshot: unknown) => void) {
      opens++; listeners.set(id, next); queueMicrotask(() => next({ docs: [] }));
      return () => { listeners.delete(id); };
    },
  });
  const db = { collection: (name: string) => {
    assert.equal(name, 'events'); return query();
  } } as unknown as Firestore;
  const load = () => loadCompanyEventSnapshot(db, 'US:AMD');
  await Promise.all([load(), load()]);
  assert.equal(opens, 1);
  const first = { id: 'first', data: () => ({ title: 'New filing' }) };
  listeners.get('US:AMD')!({ docs: [first] });
  assert.equal((await load()).docs[0].data().title, 'New filing');
  listeners.get('US:AMD')!({ docs: [{ id: 'first', data: () => ({ title: 'Corrected filing' }) }] });
  assert.equal((await load()).docs[0].data().title, 'Corrected filing');
  listeners.get('US:AMD')!({ docs: [] });
  assert.equal((await load()).docs.length, 0);
  assert.equal(opens, 1, 'empty results and deletions remain cached');
  for (let i = 0; i < 256; i++) await loadCompanyEventSnapshot(db, `US:C${i}`);
  assert.equal(listeners.size, 256);
  assert.equal(listeners.has('US:AMD'), false);
  const before = opens;
  await load(); assert.equal(opens, before + 1);
});
