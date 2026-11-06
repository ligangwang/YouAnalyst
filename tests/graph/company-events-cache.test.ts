import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCompanyEventSnapshot } from '../../src/lib/events/company-events-cache';
import { closeLocalCaches } from '../../src/lib/local-cache/watch';

test('company events share loads, receive changes and remain bounded', async t => {
  t.after(closeLocalCaches);
  const cacheLogs:Record<string,unknown>[]=[];
  t.mock.method(console,'info',(line:string)=>cacheLogs.push(JSON.parse(line)));
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
  // Replay the observed 1,531-query company working set twice without reopening reads.
  for(let visit=0;visit<2;visit++)for(let i=0;i<1531;i++)await loadCompanyEventSnapshot(db, `US:C${i}`);
  await load();
  assert.equal(opens,1532);
  assert(cacheLogs.some(log=>log.action==='hit'&&log.companyId==='US:AMD'));
  for (let i = 1531; i < 2048; i++) await loadCompanyEventSnapshot(db, `US:C${i}`);
  assert.equal(listeners.size, 2048);
  assert.equal(listeners.has('US:C0'), false);
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='entry_limit'&&log.companyId==='US:C0'));
  const before = opens;
  await loadCompanyEventSnapshot(db,'US:C0'); assert.equal(opens, before + 1);
  // The byte ceiling still applies independently of the larger entry budget.
  for(let i=0;i<20;i++){
    const id=`US:BIG${i}`;await loadCompanyEventSnapshot(db,id);
    listeners.get(id)!({docs:[{data:()=>({text:'x'.repeat(1_000_000)})}]});
    await Promise.resolve();
  }
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='byte_limit'));
});
