import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { changeCached, applyCacheChange } from '../../src/lib/change-cache';
import { observeFirestore } from '../../src/lib/firebase/firestore-observability';
import { closeLocalCaches } from '../../src/lib/local-cache/watch';
function fixture() {
  const values = new Map<string, unknown>(), listeners = new Map<string, Set<(value: unknown)=>void>>();
  let opens=0, gets=0;
  const raw = {collection: (collection:string) => ({doc:(id:string) => {
    const path=`${collection}/${id}`;
    const ref={path,id,isEqual:(other:{path:string})=>other.path===path,
      get:async()=>{gets++;return snap();},
      onSnapshot:(next:(value:unknown)=>void)=>{opens++;const set=listeners.get(path)??new Set();listeners.set(path,set);set.add(next);queueMicrotask(()=>next(snap()));return ()=>{set.delete(next);};}};
    const snap=()=>({id,ref,exists:values.has(path),data:()=>values.get(path),get:()=>values.get(path)});
    return ref;
  }}), getAll:async(...refs:{get:()=>Promise<unknown>}[])=>Promise.all(refs.map(ref=>ref.get()))};
  const db=observeFirestore(raw as unknown as Firestore,()=>{});
  return {db,values,get opens(){return opens;},get gets(){return gets;},set(path:string,value:unknown){
    if(value===undefined)values.delete(path);else values.set(path,value);
    for(const next of listeners.get(path)??[])next({id:path.split('/')[1],exists:values.has(path),data:()=>values.get(path)});
  }};
}
test('exact source documents push updates/deletes without shared metadata or polling',async(t)=>{
 t.after(closeLocalCaches);const f=fixture();f.values.set('collectors/A',{count:1});f.values.set('collectors/B',{count:2});
 const load=()=>changeCached(f.db,'statuses',['collectors'],()=>f.db.getAll(f.db.collection('collectors').doc('A'),f.db.collection('collectors').doc('B')));
 await Promise.all([load(),load()]);assert.equal(f.opens,2);assert.equal(f.gets,0);
 f.set('collectors/A',{count:3});assert.deepEqual((await load()).map(doc=>doc.data()),[{count:3},{count:2}]);
 f.set('collectors/A',undefined);assert.equal((await load())[0].exists,false);assert.equal(f.opens,2);
});
test('uncached reads retain SDK semantics and derived results are never frozen',async(t)=>{
 t.after(closeLocalCaches);const f=fixture();let optional=1;
 const load=()=>changeCached(f.db,'view',['events'],async()=>({doc:await f.db.collection('events').doc('A').get(),optional}));
 await load();optional=2;assert.equal((await load()).optional,2);assert.equal(f.opens,1);
 await f.db.collection('events').doc('A').get();assert.equal(f.gets,1);
});
test('retired event receiver acknowledges valid delayed deliveries without touching Firestore',async()=>{
 const db={collection:()=>{throw Error('must not read or write metadata');}} as unknown as Firestore;
 const headers=new Headers({'ce-id':'id','ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-subject':'documents/collectors/A'});
 await applyCacheChange(db,headers,'test');await assert.rejects(applyCacheChange(db,headers,'other'),/Invalid/);
});
test('oversized source snapshots are released instead of permanently retained',async(t)=>{
 t.after(closeLocalCaches);const f=fixture();f.values.set('directory_syncs/A',{large:'x'.repeat(5*1024*1024)});
 const load=()=>changeCached(f.db,'large',['directory_syncs'],()=>f.db.collection('directory_syncs').doc('A').get());
 await load();await load();assert.equal(f.opens,2);
});

test('source subscription count is bounded and SDK reference values do not break sizing',async(t)=>{
 t.after(closeLocalCaches);const f=fixture();const ref:{path:string;isEqual:()=>boolean;self?:unknown}={path:'companies/A',isEqual:()=>true};ref.self=ref;
 f.values.set('directory_syncs/0',{ref});
 const load=(id:string)=>changeCached(f.db,id,['directory_syncs'],()=>f.db.collection('directory_syncs').doc(id).get());
 for(let i=0;i<129;i++)await load(String(i));
 assert.equal(f.opens,129);await load('0');assert.equal(f.opens,130,'oldest unused source was evicted');
});


test('repeated pageviews across the supported universe do not reopen unchanged sources', async t => {
 t.after(closeLocalCaches);
 const f=fixture();
 const {readCompanyLookup}=await import('../../src/lib/company-lookup-cache');
 const read=(collection:string,id:string)=>changeCached(f.db,id,[],()=>f.db.collection(collection).doc(id).get());
 // Company routes, symbol-equivalent keys, news health and SEC identities exceed
 // the old shared 128-listener budget even before chart traffic is considered.
 for(let i=0;i<180;i++){
  f.values.set(`companies/${i}`,{name:`Company ${i}`});
  await readCompanyLookup(f.db,f.db.collection('companies').doc(String(i)));
  await read('companies',`symbol-${i}`);
  await read('collectors',`news-health-${i}`);
  await read('collectors',`sec-identity-${i}`);
 }
 // Each history is larger than the old entire 4 MiB cache after a few charts.
 for(let i=0;i<12;i++){
  f.values.set(`eod_prices/${i}`,{history:'x'.repeat(500_000)});
  await read('eod_prices',String(i));
 }
 const opens=f.opens;
 for(let view=0;view<3;view++)for(let i=0;i<180;i++){
  await read('companies',String(i));
  await readCompanyLookup(f.db,f.db.collection('companies').doc(`symbol-${i}`));
  await read('collectors',`news-health-${i}`);
  await read('collectors',`sec-identity-${i}`);
  await read('eod_prices',String(i%12));
 }
 assert.equal(f.opens,opens,'warm pageviews must cause zero new Firestore subscriptions');
 assert.equal(f.gets,0);
 f.set('companies/0',{name:'Changed'});
 assert.deepEqual((await read('companies','0')).data(),{name:'Changed'});
 f.set('companies/0',undefined);
 assert.equal((await readCompanyLookup(f.db,f.db.collection('companies').doc('0'))).exists,false);
 assert.equal(f.opens,opens,'changes and deletes are pushed without a reload');
});
