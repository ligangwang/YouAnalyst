import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {applyCacheChange,changeCached,CHANGE_CACHE_DOCUMENT,withCacheReadScope} from '../../src/lib/change-cache';

function fixture(){
  const state:{enabled:boolean;versions:Record<string,string>}={enabled:true,versions:{}};
  let unavailable=false,writes=0,checks=0;
  const db={runTransaction:async(work:(tx:unknown)=>Promise<void>)=>work({get:async()=>({data:()=>structuredClone(state)}),set:(ref:{set:(value:unknown)=>Promise<void>},value:unknown)=>ref.set(value)}),collection:(name:string)=>({doc:(id:string)=>({
    get:async()=>{checks++;assert.equal(name,'collectors');assert.equal(id,CHANGE_CACHE_DOCUMENT);if(unavailable)throw Error('offline');return {data:()=>structuredClone(state)};},
    set:async(value:{versions:Record<string,string>})=>{if(id===CHANGE_CACHE_DOCUMENT){writes++;Object.assign(state.versions,value.versions);}},
  })})} as unknown as Firestore;
  return {db,state,get writes(){return writes;},get checks(){return checks;},fail(value:boolean){unavailable=value;}};
}
function event(collection:string,id='test'){
  return new Headers({'ce-id':'delivery-1','ce-type':'google.cloud.firestore.document.v1.written',
    'ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-subject':`documents/${collection}/${id}`});
}
test('unchanged data survives arbitrary elapsed time; unrelated changes do not reload it',async()=>{
  const f=fixture();let calls=0;
  const load=async()=>++calls;
  assert.deepEqual(await Promise.all([changeCached(f.db,'graph',['companies'],load),changeCached(f.db,'graph',['companies'],load)]),[1,1]);
  const original=Date.now;try{Date.now=()=>original()+365*86400000;assert.equal(await changeCached(f.db,'graph',['companies'],load),1);}finally{Date.now=original;}
  await applyCacheChange(f.db,event('eod_prices'),'test');
  assert.equal(await changeCached(f.db,'graph',['companies'],load),1);
  await applyCacheChange(f.db,event('companies'),'test');
  assert.equal(await changeCached(f.db,'graph',['companies'],load),2);
});
test('corrections, deletions and late deliveries invalidate; cache writes never loop',async()=>{
  const f=fixture();let source:number|null=10,reads=0;
  const load=async()=>{reads++;return source;};
  assert.equal(await changeCached(f.db,'price',['eod_prices'],load),10);
  source=12;await applyCacheChange(f.db,event('eod_prices'),'test');
  assert.equal(await changeCached(f.db,'price',['eod_prices'],load),12);
  source=null;const late=event('eod_prices');late.set('ce-time','2000-01-01T00:00:00Z');
  await applyCacheChange(f.db,late,'test');assert.equal(await changeCached(f.db,'price',['eod_prices'],load),null);
  await applyCacheChange(f.db,event('collectors',CHANGE_CACHE_DOCUMENT),'test');assert.equal(f.writes,2);assert.equal(reads,3);
});
test('a change during an in-flight read cannot poison the new revision',async()=>{
  const f=fixture();let release!:(value:string)=>void;
  const old=changeCached(f.db,'key',['companies'],()=>new Promise<string>(resolve=>{release=resolve;}));
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await applyCacheChange(f.db,event('companies'),'test');
  assert.equal(await changeCached(f.db,'key',['companies'],async()=>'new'),'new');
  release('old');assert.equal(await old,'old');
  assert.equal(await changeCached(f.db,'key',['companies'],async()=>'wrong'),'new');
});
test('disabled caches bypass, failed reads retry and failed version checks do not serve stale values',async()=>{
  const f=fixture();let reads=0;const load=async()=>++reads;
  f.state.enabled=false;
  await changeCached(f.db,'k',['users'],load);await changeCached(f.db,'k',['users'],load);assert.equal(reads,2);
  f.state.enabled=true;
  await assert.rejects(changeCached(f.db,'k',['users'],async()=>{throw Error('failed load');}),/failed load/);
  assert.equal(await changeCached(f.db,'k',['users'],load),3);
  f.fail(true);await assert.rejects(changeCached(f.db,'k',['users'],load),/offline/);
  f.fail(false);assert.equal(await changeCached(f.db,'k',['users'],load),3);
});
test('wrong project, event type and untracked collection cannot mutate versions',async()=>{
  const f=fixture();await assert.rejects(applyCacheChange(f.db,event('companies'),'other'));
  const wrong=event('companies');wrong.set('ce-type','fake');await assert.rejects(applyCacheChange(f.db,wrong,'test'));
  await assert.rejects(applyCacheChange(f.db,event('private_collection'),'test'));assert.equal(f.writes,0);
});

test('one request shares one metadata check, while the next request sees changes',async()=>{
 const f=fixture();let loads=0;
 await withCacheReadScope(async()=>{
  await changeCached(f.db,'graph',['companies'],async()=>++loads);
  await changeCached(f.db,'sources',['companies'],async()=>++loads);
 });
 assert.equal(f.checks,1);assert.equal(loads,2);
 await applyCacheChange(f.db,event('companies'),'test');
 await changeCached(f.db,'graph',['companies'],async()=>++loads);
 assert.equal(f.checks,2);assert.equal(loads,3);
});

test('a degraded optional-data result is returned but not frozen in cache',async()=>{
 const f=fixture();let healthy=false,reads=0;
 const load=async()=>{reads++;return {partial:!healthy};};
 assert.deepEqual(await changeCached(f.db,'optional',['companies'],load,value=>!value.partial),{partial:true});
 healthy=true;
 assert.deepEqual(await changeCached(f.db,'optional',['companies'],load,value=>!value.partial),{partial:false});
 await changeCached(f.db,'optional',['companies'],load,value=>!value.partial);assert.equal(reads,2);
});

test('news status invalidation follows source IDs, with legacy fallback and delete events',async()=>{
 const {loadNewsCollectorStatuses}=await import('../../src/lib/intelligence/collectors/status-cache');
 const state={enabled:true,versions:{} as Record<string,string>,collectorDocumentsTracked:false};
 let reads=0,fail=false;
 const rows=new Map([['news-a',{lastSuccessAt:'today'}],['news-b',{lastSuccessAt:'yesterday'}]]);
 const db={runTransaction:async(work:(tx:unknown)=>Promise<void>)=>work({get:async()=>({data:()=>structuredClone(state)}),set:(ref:{set:(value:unknown)=>Promise<void>},value:unknown)=>ref.set(value)}),collection:()=>({doc:(id:string)=>({id,get:async()=>({data:()=>structuredClone(state)}),set:async(value:typeof state)=>{const {versions,...metadata}=value;Object.assign(state.versions,versions);Object.assign(state,metadata);}})}),getAll:async(...refs:{id:string}[])=>{reads++;if(fail)throw Error('offline');return refs.map(ref=>({id:ref.id,data:()=>rows.get(ref.id)}));}} as unknown as Firestore;
 const load=()=>loadNewsCollectorStatuses(db,['news-a','news-b']);
 await load();state.versions.collectors='old';await load();assert.equal(reads,2);
 await applyCacheChange(db,event('collectors','other-source'),'test');await load();assert.equal(reads,3);
 await applyCacheChange(db,event('collectors','other-source'),'test');await load();assert.equal(reads,3);
 await applyCacheChange(db,event('collectors','_graph_prices_v1'),'test');await load();assert.equal(reads,3);
 rows.delete('news-a');await applyCacheChange(db,event('collectors','news-a'),'test');
 const result=await load();assert.equal(reads,4);assert.equal(result[0].data(),undefined);
 await applyCacheChange(db,event('collectors','news-b'),'test');fail=true;await assert.rejects(load(),/offline/);fail=false;await load();assert.equal(reads,6);
 // An old receiver changes only the global token. A new unrelated event must not hide that gap.
 state.versions.collectors='legacy-late';
 await applyCacheChange(db,event('collectors','other-source'),'test');
 await load();assert.equal(reads,7);
 state.versions.collectors='legacy-after';await load();assert.equal(reads,8);
});
