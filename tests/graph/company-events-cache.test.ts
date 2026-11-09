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
      opens++; listeners.set(id, next); queueMicrotask(() => next({ docs: /^US:C\d+$/.test(id)&&Number(id.slice(4))<4000
        ? Array.from({length:30},(_,i)=>({id:`${id}-${i}`,data:()=>({title:'x'.repeat(1000)})})) : [] }));
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
  // Empty queries have no document bytes but still retain SDK stream state.
  // Replay the overnight high-cardinality crawl and assert the bound throughout.
  for(let i=0;i<16000;i++){
    await loadCompanyEventSnapshot(db, `US:EMPTY${i}`);
    assert(listeners.size<=2048, 'live SDK subscriptions stay bounded even for empty results');
  }
  assert.equal(listeners.size,2048);
  assert.equal(listeners.has('US:AMD'),false);
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='entry_limit'&&log.companyId==='US:AMD'));
  const before = opens;
  await loadCompanyEventSnapshot(db,'US:EMPTY15999');
  assert.equal(opens,before,'recent empty query is reused');
  await Promise.all([load(),load()]);
  assert.equal(opens,before+1,'evicted query reopens once for concurrent readers');
  listeners.get('US:AMD')!({docs:[first]});
  assert.equal((await load()).docs[0].data().title,'New filing');
  // The byte ceiling still applies independently of the listener budget.
  for(let i=0;i<180;i++){
    const id=`US:BIG${i}`;await loadCompanyEventSnapshot(db,id);
    listeners.get(id)!({docs:[{data:()=>({text:'x'.repeat(1_000_000)})}]});
    await Promise.resolve();
  }
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='byte_limit'));
});
