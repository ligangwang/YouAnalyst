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
    limit(count: number) { assert.equal(count, 12); return this; },
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
  const load = () => loadCompanyEventSnapshot(db, 'US:AMD',12);
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
    await loadCompanyEventSnapshot(db, `US:EMPTY${i}`,12);
    assert(listeners.size<=2048, 'live SDK subscriptions stay bounded even for empty results');
  }
  assert.equal(listeners.size,2048);
  assert.equal(listeners.has('US:AMD'),false);
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='entry_limit'&&log.companyId==='US:AMD'));
  const before = opens;
  await loadCompanyEventSnapshot(db,'US:EMPTY15999',12);
  assert.equal(opens,before,'recent empty query is reused');
  await Promise.all([load(),load()]);
  assert.equal(opens,before+1,'evicted query reopens once for concurrent readers');
  listeners.get('US:AMD')!({docs:[first]});
  assert.equal((await load()).docs[0].data().title,'New filing');
  // The byte ceiling still applies independently of the listener budget.
  for(let i=0;i<180;i++){
    const id=`US:BIG${i}`;await loadCompanyEventSnapshot(db,id,12);
    listeners.get(id)!({docs:[{data:()=>({text:'x'.repeat(1_000_000)})}]});
    await Promise.resolve();
  }
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='byte_limit'));
});

test('announcements read a twelve-document prefix and only the remaining search window when needed', async t => {
  const {companyAnnouncementsFromEvents}=await import('../../src/lib/events/company-announcements');
  t.after(closeLocalCaches);
  t.mock.method(console,'info',()=>{});
  const companyId='US:AMD';
  const docs=Array.from({length:35},(_,i)=>({
    id:String(i), data:()=>({companyId,id:String(i),version:1,type:'company_disclosure',sourceType:'sec',
      title:'Filing '+i,url:'https://www.sec.gov/Archives/edgar/data/1/000000000000000001/f.htm',publication_date:'2026-01-02'})
  }));
  const queries:string[]=[];
  const refresh=new Map<string,()=>void>();
  function query(after=-1,limit=0){
    const key=after+'/'+limit;
    return {key,where:()=>query(after,limit),orderBy:()=>query(after,limit),
      limit:(n:number)=>query(after,n),startAfter:(doc:typeof docs[number])=>query(Number(doc.id),limit),
      isEqual:(other:{key:string})=>key===other.key,
      onSnapshot(next:(s:unknown)=>void){
        queries.push(key);
        const update=()=>next({docs:docs.slice(after+1,after+1+limit)});
        refresh.set(key,update);update();return ()=>refresh.delete(key);
      }};
  }
  const db={collection:()=>query()} as unknown as Firestore;
  const load=()=>companyAnnouncementsFromEvents(db,companyId,[],'2026-01-03');
  assert.equal((await load()).length,12);
  assert.deepEqual(queries,['-1/12']);
  const original=docs[0].data;
  docs[0].data=()=>({...original(),sourceType:'unapproved'});
  refresh.get('-1/12')!();
  assert.deepEqual((await load()).map(row=>row.id),docs.slice(1,13).map(row=>row.id));
  assert.deepEqual(queries,['-1/12','11/18']);
  docs[0].data=original;
  refresh.get('-1/12')!();
  assert.equal((await load())[0].id,'0');
  assert.equal(queries.length,2);
});
