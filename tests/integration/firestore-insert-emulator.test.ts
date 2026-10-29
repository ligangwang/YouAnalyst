// Run against a local emulator:
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 npx tsx --test tests/integration/firestore-insert-emulator.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Firestore, type Transaction } from '@google-cloud/firestore';
import { createCachedPriceBatch } from '../../src/lib/intelligence/price-cache';
import { saveDisclosures } from '../../src/lib/events/disclosure-store';
import { secDisclosureRows } from '../../src/lib/events/disclosures';
import { FEED_CHANGE_FIELD, FEED_REVISION_DOCUMENT } from '../../src/lib/intelligence/feed-cache-changes';

const host=process.env.FIRESTORE_EMULATOR_HOST;
// Never connect this test to a production database, even with ADC available.
if(host&&!/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw Error('Local Firestore emulator required');
const emulatorTest=host?test:test.skip;
const key='US_UNIT', bucketId=createHash('sha256').update(key).digest('hex').slice(0,2);
const at='2026-10-28T12:00:00Z';
const day=(n:number)=>new Date(Date.UTC(2026,0,1+n)).toISOString().slice(0,10);
const rows=(db:Firestore,days:number[],base=100)=>days.map(n=>({ref:db.collection('eod_prices').doc(`${key}_${day(n)}`),
  patch:{ticker:'UNIT',market:'US',isFinal:true,tradingDate:day(n),rawClose:base+n}}));
function client(){return new Firestore({projectId:`demo-insert-${randomUUID().slice(0,8)}`});}
function disclosures(count:number){return secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent:{
  accessionNumber:Array.from({length:count},(_,i)=>`0000723125-26-${String(i+1).padStart(6,'0')}`),
  form:Array(count).fill('4'),filingDate:Array(count).fill('2026-01-02'),primaryDocument:Array(count).fill('filing.xml'),
}}});}

emulatorTest('full-sized historical batch succeeds with the SDK query limit and transaction semantics',async t=>{
  const db=client();t.after(()=>db.terminate());
  const input=rows(db,Array.from({length:1500},(_,i)=>i));
  assert.deepEqual(await createCachedPriceBatch(db,input,{createFirst:true}),{created:1500,existing:0});
  assert.equal((await db.collection('eod_prices').count().get()).data().count,1500);
});

for(const createFirst of [false,true])emulatorTest(`real concurrent price transactions preserve the winning price and publish a consistent graph cache (createFirst=${createFirst})`,async t=>{
  const db=client();t.after(()=>db.terminate());
  const bucket=db.collection('collectors').doc(`_graph_prices_v1_${bucketId}`);
  const revision=db.collection('collectors').doc('_graph_prices_v1');
  await bucket.set({entries:{[key]:{bars:[],baselines:{[day(50)]:null}}}});
  await revision.set({buckets:{[bucketId]:'before',other:'untouched'}});
  // Both transactions read an overlapping set before attempting conflicting creates.
  const results=await Promise.all([
    createCachedPriceBatch(db,rows(db,Array.from({length:40},(_,i)=>i),100),{createFirst}),
    createCachedPriceBatch(db,rows(db,Array.from({length:40},(_,i)=>i+20),1000),{createFirst}),
  ]);
  assert.equal(results.reduce((sum,r)=>sum+r.created,0),60);
  assert.equal(results.reduce((sum,r)=>sum+r.existing,0),20);
  const prices=await db.collection('eod_prices').get();assert.equal(prices.size,60);
  const cache=(await bucket.get()).get(`entries.${key}`);
  const expected=prices.docs.map(doc=>({date:doc.get('tradingDate'),close:doc.get('rawClose')})).sort((a,b)=>a.date.localeCompare(b.date)).slice(-2);
  assert.deepEqual(cache.bars,expected);assert.deepEqual(cache.baselines,{});
  assert.equal((await revision.get()).get('buckets.other'),'untouched');
  const original=(await rows(db,[25])[0].ref.get()).data(),before=(await revision.get()).data();
  assert.deepEqual(await createCachedPriceBatch(db,rows(db,[25],9999),{createFirst}),{created:0,existing:1});
  assert.deepEqual((await rows(db,[25])[0].ref.get()).data(),original);
  assert.deepEqual((await revision.get()).data(),before);
});

emulatorTest('real overlapping disclosure deliveries create once and keep arrival timestamps and feed markers atomic',async t=>{
  const db=client();t.after(()=>db.terminate());const input=disclosures(65);
  const counts=await Promise.all([saveDisclosures(db,input,at,true),saveDisclosures(db,input,'2026-10-28T13:00:00Z',false)]);
  assert.equal(counts.reduce((a,b)=>a+b,0),65);
  const saved=await db.collection('events').get();assert.equal(saved.size,65);
  const revision=db.collection('collectors').doc(FEED_REVISION_DOCUMENT),marker=(await revision.get()).get('changedAt');
  for(const doc of saved.docs){
    const data=doc.data();assert.equal(data.collected_at,data.processed_at);
    assert.equal(data.baseline,data.collected_at===at);
    assert(data[FEED_CHANGE_FIELD].isEqual(marker),'event and revision server timestamps share a commit');
    assert.equal(data.insiderEnrichmentPending,true);
  }
  const before=saved.docs.map(doc=>doc.data());
  assert.equal(await saveDisclosures(db,input,'2026-10-28T14:00:00Z',false),0);
  assert.deepEqual((await db.collection('events').get()).docs.map(doc=>doc.data()),before);
  assert((await revision.get()).get('changedAt').isEqual(marker));
});

emulatorTest('actual aborted transactions leave source documents and cache revisions unchanged',async t=>{
  const db=client();t.after(()=>db.terminate());
  const bucket=db.collection('collectors').doc(`_graph_prices_v1_${bucketId}`);
  await bucket.set({entries:{[key]:{bars:[],baselines:{}}}});
  const before=(await bucket.get()).data();
  // Execute all production reads/writes on a real SDK Transaction, then abort
  // before commit. No in-memory fixture can accidentally publish staged writes.
  const failing=new Proxy(db,{get(target,prop){
    if(prop==='runTransaction')return (work:(tx:Transaction)=>Promise<unknown>)=>target.runTransaction(async tx=>{
      await work(tx);throw Error('Injected abort before commit');
    });
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;
  }});
  await assert.rejects(createCachedPriceBatch(failing,rows(db,[1,2]),{createFirst:true}),/Injected abort/);
  assert((await db.collection('eod_prices').get()).empty);
  assert.deepEqual((await bucket.get()).data(),before);
  assert(!(await db.collection('collectors').doc('_graph_prices_v1').get()).exists);
  await assert.rejects(saveDisclosures(failing,disclosures(2),at,false),/Injected abort/);
  assert((await db.collection('events').get()).empty);
  assert(!(await db.collection('collectors').doc(FEED_REVISION_DOCUMENT).get()).exists);
});
