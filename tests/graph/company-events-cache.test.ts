import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCompanyEventSnapshot, ANNOUNCEMENT_EVENT_FIELDS } from '../../src/lib/events/company-events-cache';
import { closeLocalCaches } from '../../src/lib/local-cache/watch';
import {sourceSnapshot,withSourceCache} from '../../src/lib/local-cache/read-scope';

test('event eviction prefers old empty queries while retaining recent negative results and live pages',async t=>{
 t.after(closeLocalCaches);const owner={},listeners=new Map<string,(value:unknown)=>void>();
 const opens=new Map<string,number>(),rows=new Map<string,string[]>([['A',['one','two']],['B',[]],['C',['three']],['D',['four']],['E',[]]]);
 const logs:Record<string,unknown>[]=[];t.mock.method(console,'info',(line:string)=>logs.push(JSON.parse(line)));
 const snapshot=(id:string)=>({docs:(rows.get(id)??[]).map(value=>({id:value,data:()=>({title:value})}))});
 function query(id:string){return {id,isEqual:(other:{id:string})=>id===other.id,onSnapshot(next:(value:unknown)=>void){
  opens.set(id,(opens.get(id)??0)+1);listeners.set(id,next);queueMicrotask(()=>next(snapshot(id)));return ()=>listeners.delete(id);
 }};}
 const load=(id:string)=>withSourceCache(()=>sourceSnapshot(owner,query(id),4,10000,{collection:'events',companyId:id,limit:12})!);
 for(const id of ['A','B','C','D'])await load(id);
 const empty=await Promise.all([load('E'),load('E')]);assert(empty.every(value=>value.docs.length===0));
 assert.equal(opens.get('E'),1);assert.deepEqual([...listeners.keys()],['A','C','D','E']);
 await load('E');assert.equal(opens.get('E'),1,'recent empty results remain reusable');
 assert(logs.some(log=>log.companyId==='B'&&log.action==='evict'&&log.policy==='empty_event_first'&&log.documentCount===0));
 assert(logs.some(log=>JSON.stringify(log.retainedLruQuery)===JSON.stringify({collection:'events',companyId:'A',limit:12,documentCount:2})));
 rows.set('B',['new']);assert.equal((await load('B')).docs[0].data().title,'new','evicted empty query discovers new data');
 assert.equal(opens.get('B'),2);assert.equal(listeners.size,4);
 rows.set('C',['changed']);listeners.get('C')!(snapshot('C'));assert.equal((await load('C')).docs[0].data().title,'changed');
 rows.set('C',[]);listeners.get('C')!(snapshot('C'));assert.equal((await load('C')).docs.length,0);
 assert.equal(opens.get('C'),1,'retained queries receive updates and deletions without reloading');
});

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
      if(field==='sourceType'){assert.equal(value,'sec');return this;}
      assert.equal(field, 'companyId'); assert.equal(op, '=='); return query(value);
    },
    orderBy(field: string, direction: string) {
      assert.equal(field, 'publication_date'); assert.equal(direction, 'desc'); return this;
    },
    select(...fields:string[]) { assert.deepEqual(fields,[...ANNOUNCEMENT_EVENT_FIELDS]);return this; },
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
    assert(listeners.size<=8192, 'live SDK subscriptions stay bounded even for empty results');
  }
  assert.equal(listeners.size,8192);
  assert.equal(listeners.has('US:AMD'),false);
  assert(cacheLogs.some(log=>log.action==='evict'&&log.reason==='entry_limit'&&log.companyId==='US:AMD'));
  const retainedOpens = opens;
  await loadCompanyEventSnapshot(db,'US:EMPTY10000',12);
  assert.equal(opens,retainedOpens,'a query beyond the old 2048-entry window remains reusable');
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
  const logs:Record<string,unknown>[]=[];t.mock.method(console,'info',(line:string)=>logs.push(JSON.parse(line)));
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
      select:(...fields:string[])=>{assert.deepEqual(fields,['version','companyId','id','title','url','published_at','publication_date','type','sourceType','sourceId','category','form']);return query(after,limit);},
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
  assert(logs.some(log=>log.action==='miss'&&log.limit===12&&log.afterCursor===undefined));
  assert(logs.some(log=>log.action==='miss'&&log.limit===18&&JSON.stringify(log.afterCursor)===JSON.stringify({id:'11',publicationDate:'2026-01-02'})));
  docs[0].data=original;
  refresh.get('-1/12')!();
  assert.equal((await load())[0].id,'0');
  assert.equal(queries.length,2);
});

test('events read gate switches native pagination to a bounded Parquet projection',async t=>{
 const keys=['MARKET_PARQUET_ENABLED','MARKET_READ_ONLY_PROBE','K_SERVICE','CLOUD_RUN_JOB'] as const,previous=keys.map(key=>process.env[key]);
 process.env.MARKET_PARQUET_ENABLED='1';process.env.MARKET_READ_ONLY_PROBE='1';delete process.env.K_SERVICE;delete process.env.CLOUD_RUN_JOB;
 t.after(()=>keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}));
 const {companyAnnouncementsFromEvents}=await import('../../src/lib/events/company-announcements');
 const records=Array.from({length:35},(_,i)=>({id:String(i),companyId:'US:AMD',version:1,type:'company_disclosure',sourceType:i===0?'unapproved':'sec',
  title:'Filing '+i,url:'https://www.sec.gov/Archives/edgar/data/1/000000000000000001/f.htm',publication_date:'2026-01-02',body:'unused captured article'}));
 const counts:number[]=[];
 function query(after=-1,limit=0,fields:string[]=[]){return {
  where:()=>query(after,limit,fields),orderBy:()=>query(after,limit,fields),
  select:(...selected:string[])=>query(after,limit,selected),limit:(n:number)=>query(after,n,fields),startAfter:(doc:{id:string})=>query(Number(doc.id),limit,fields),
  get:async()=>{assert.deepEqual(fields,process.env.MARKET_READ_ONLY_PROBE==='1'?['version','companyId','id','title','url','published_at','publication_date','type','sourceType','sourceId','category','form']:[]);counts.push(limit);return {docs:records.slice(after+1,after+1+limit).map(row=>({id:row.id,data:()=>row}))};},
 };}
 const db={collection:()=>query()} as unknown as Firestore;
 for(const probe of ['0','1']){
  process.env.MARKET_READ_ONLY_PROBE=probe;counts.length=0;
  assert.deepEqual((await companyAnnouncementsFromEvents(db,'US:AMD',[],'2026-01-03')).map(row=>row.id),Array.from({length:12},(_,i)=>String(i+1)));
  assert.deepEqual(counts,probe==='1'?[30]:[12,18]);
 }
});
