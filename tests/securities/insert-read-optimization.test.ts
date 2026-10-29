import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { earningsFirestore } from '../helpers/earnings-firestore';
import { existingDocumentIds, runInsertTransaction } from '../../src/lib/firebase/insert-transaction';
import { createCachedPriceBatch } from '../../src/lib/intelligence/price-cache';
import { saveDisclosures } from '../../src/lib/events/disclosure-store';
import { secDisclosureRows } from '../../src/lib/events/disclosures';
import { FEED_CHANGE_FIELD, FEED_REVISION_DOCUMENT } from '../../src/lib/intelligence/feed-cache-changes';

const ticker='UNIT', key='US_UNIT';
const bucketId=createHash('sha256').update(key).digest('hex').slice(0,2);
const bucketPath=`collectors/_graph_prices_v1_${bucketId}`, revisionPath='collectors/_graph_prices_v1';
const feedPath=`collectors/${FEED_REVISION_DOCUMENT}`;
const date=(n:number)=>new Date(Date.UTC(2026,0,1+n)).toISOString().slice(0,10);
const bar=(n:number,close=100+n)=>({date:date(n),close});
const priceRows=(db:Firestore,days:number[])=>days.map(n=>({ref:db.collection('eod_prices').doc(`${key}_${date(n)}`),
  patch:{ticker,market:'US',isFinal:true,tradingDate:date(n),rawClose:100+n}}));
function seedCache(f:ReturnType<typeof earningsFirestore>){
  f.rows.set(bucketPath,{entries:{[key]:{bars:[bar(0)],baselines:{[date(0)]:bar(0),[date(20)]:bar(0)}}}});
  f.rows.set(revisionPath,{buckets:{[bucketId]:'before',other:'untouched'}});
}
const entry=(f:ReturnType<typeof earningsFirestore>)=>(f.rows.get(bucketPath)!.entries as Record<string,{bars:ReturnType<typeof bar>[];baselines:Record<string,ReturnType<typeof bar>>}>)[key];
function disclosures(count:number){
  return secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent:{
    accessionNumber:Array.from({length:count},(_,i)=>`0000723125-26-${String(i+1).padStart(6,'0')}`),
    form:Array(count).fill('4'),filingDate:Array(count).fill('2026-01-02'),primaryDocument:Array(count).fill('filing.xml'),
  }}});
}
const at='2026-10-28T12:00:00Z';

test('create-first onboarding commits prices and cache with no existence queries',async()=>{
  const f=earningsFirestore();seedCache(f);
  assert.deepEqual(await createCachedPriceBatch(f.db,priceRows(f.db,[1,2]),{createFirst:true}),{created:2,existing:0});
  assert.equal(f.queries.length,0);assert.deepEqual(f.reads,[bucketPath]);
  assert.deepEqual(entry(f).bars,[bar(1),bar(2)]);
  assert.deepEqual(entry(f).baselines,{[date(0)]:bar(0)});
  assert.equal(f.writes.filter(path=>path===revisionPath).length,1);
});

test('create-first conflict falls back to grouped reads and preserves authoritative prices',async()=>{
  const f=earningsFirestore();seedCache(f);
  const rows=priceRows(f.db,Array.from({length:31},(_,i)=>i+1));
  f.rows.set(rows[0].ref.path,{...rows[0].patch,rawClose:777});
  assert.deepEqual(await createCachedPriceBatch(f.db,rows,{createFirst:true}),{created:30,existing:1});
  assert.deepEqual(f.queries.map(q=>q.ids?.length),[30,1]);
  assert.equal(f.rows.get(rows[0].ref.path)?.rawClose,777);
  assert(!f.writes.includes(rows[0].ref.path));
  assert.equal(f.reads.length,2);
  assert.equal(f.writes.filter(path=>path===revisionPath).length,1,'failed fast path publishes nothing');
});

test('create-first race rereads the winning cache instead of publishing speculative prices',async()=>{
  const f=earningsFirestore();seedCache(f);const rows=priceRows(f.db,[1,2]);
  f.beforeCommit(()=>{
    f.rows.set(rows[0].ref.path,{...rows[0].patch,rawClose:777});
    f.rows.set(bucketPath,{entries:{[key]:{bars:[bar(0),bar(1,777)],baselines:{[date(0)]:bar(0)}}}});
  });
  assert.deepEqual(await createCachedPriceBatch(f.db,rows,{createFirst:true}),{created:1,existing:1});
  assert.deepEqual(entry(f).bars,[bar(1,777),bar(2)]);
  assert.equal(f.queries.length,1);assert.equal(f.reads.length,2);
  const before=structuredClone([...f.rows]);
  assert.deepEqual(await createCachedPriceBatch(f.db,rows,{createFirst:true}),{created:0,existing:2});
  assert.deepEqual([...f.rows],before,'an all-existing replay publishes no cache update');
});

test('create-first non-conflict failure rolls back all writes without querying or retrying',async()=>{
  const f=earningsFirestore();seedCache(f);const before=structuredClone([...f.rows]);
  f.reject(path=>path===revisionPath);
  await assert.rejects(createCachedPriceBatch(f.db,priceRows(f.db,[1,2]),{createFirst:true}),/Injected Firestore commit failure/);
  assert.deepEqual([...f.rows],before);assert.equal(f.writes.length,0);
  assert.equal(f.queries.length,0);assert.equal(f.reads.length,1);
});

test('1500 absent prices use 50 exact-ID queries and one cache read, with no price point reads',async()=>{
  const f=earningsFirestore(),rows=priceRows(f.db,Array.from({length:1500},(_,i)=>i));
  assert.deepEqual(await createCachedPriceBatch(f.db,rows),{created:1500,existing:0});
  assert.equal(f.queries.length,50);
  assert(f.queries.every(q=>q.collection==='eod_prices'&&q.ids?.length===30));
  assert.deepEqual(f.reads,[bucketPath]);
  assert(!f.rows.has(bucketPath));assert(!f.rows.has(revisionPath),'uninitialized caches stay uninitialized');
});

test('price ID queries preserve existing data, exclude unrelated dates, and handle the 30-ID boundary',async()=>{
  const f=earningsFirestore(),rows=priceRows(f.db,Array.from({length:31},(_,i)=>i*2));
  f.rows.set(rows[0].ref.path,{rawClose:999,authoritative:true});
  f.rows.set(`eod_prices/${key}_${date(1)}`,{rawClose:888});
  assert.deepEqual(await createCachedPriceBatch(f.db,rows),{created:30,existing:1});
  assert.deepEqual(f.queries.map(q=>q.ids?.length),[30,1]);
  assert.deepEqual(f.rows.get(rows[0].ref.path),{rawClose:999,authoritative:true});
  assert(!f.queries.flatMap(q=>q.ids??[]).includes(`${key}_${date(1)}`));
});

test('price create race rereads both sources and cache, preserving the winner and invalidating baselines atomically',async()=>{
  const f=earningsFirestore();seedCache(f);
  const rows=priceRows(f.db,[1,2]);
  // A different transaction commits after our query but before our create.
  f.beforeCommit(()=>{
    f.rows.set(rows[0].ref.path,{...rows[0].patch,rawClose:777});
    f.rows.set(bucketPath,{entries:{[key]:{bars:[bar(0),bar(1,777)],baselines:{[date(0)]:bar(0),[date(20)]:bar(0)}}}});
    f.rows.set(revisionPath,{buckets:{[bucketId]:'competitor',other:'untouched'}});
  });
  assert.deepEqual(await createCachedPriceBatch(f.db,rows),{created:1,existing:1});
  assert.equal(f.rows.get(rows[0].ref.path)?.rawClose,777);
  assert.deepEqual(entry(f).bars,[bar(1,777),bar(2)]);
  assert.deepEqual(entry(f).baselines,{[date(0)]:bar(0)});
  assert.equal(f.writes.filter(path=>path===revisionPath).length,1,'failed attempt publishes no revision');
  assert.equal((f.rows.get(revisionPath)!.buckets as Record<string,string>).other,'untouched');
  assert.equal(f.queries.length,2,'conflicting create retries the existence query');
  assert.equal(f.reads.length,2,'cache bucket is reread on retry');
});

test('overlapping price batches create each source once and keep both latest closes',async()=>{
  const f=earningsFirestore();seedCache(f);
  const results=await Promise.all([createCachedPriceBatch(f.db,priceRows(f.db,[1,2])),createCachedPriceBatch(f.db,priceRows(f.db,[2,3]))]);
  assert.equal(results.reduce((n,r)=>n+r.created,0),3);
  assert.deepEqual(entry(f).bars,[bar(2),bar(3)]);
  assert.equal(f.writes.filter(path=>path.startsWith('eod_prices/')).length,3);
  const before=structuredClone([...f.rows]);
  assert.deepEqual(await createCachedPriceBatch(f.db,priceRows(f.db,[1,2,3])),{created:0,existing:3});
  assert.deepEqual([...f.rows],before,'duplicate delivery does not rewrite the cache');
});

test('price commit failure publishes neither new prices nor cache state',async()=>{
  const f=earningsFirestore();seedCache(f);const before=structuredClone([...f.rows]);
  f.reject(path=>path===revisionPath);
  await assert.rejects(createCachedPriceBatch(f.db,priceRows(f.db,[1,2])),/Injected Firestore commit failure/);
  assert.deepEqual([...f.rows],before);assert.equal(f.writes.length,0);
  assert.equal(f.queries.length,1,'unrelated failures are not retried');
});

test('disclosures query in bounded groups across transaction batches, preserve originals and deduplicate input',async()=>{
  const f=earningsFirestore(),rows=disclosures(101);
  const original={...rows[0],collected_at:'2026-01-03',baseline:true};f.rows.set(`events/${rows[0].id}`,original);
  assert.equal(await saveDisclosures(f.db,[...rows,rows[1]],at,false),100);
  assert.deepEqual(f.queries.map(q=>q.ids?.length),[30,30,30,10,1]);
  assert.equal(f.reads.length,0);
  assert.deepEqual(f.rows.get(`events/${rows[0].id}`),original);
  const created=f.rows.get(`events/${rows[1].id}`)!;
  assert.equal(created.collected_at,at);assert.equal(created.processed_at,at);
  assert.equal(created.insiderEnrichmentPending,true);assert(FEED_CHANGE_FIELD in created);
  assert(f.rows.has(feedPath));
});

test('concurrent disclosure insert preserves first arrival and only publishes changes for new events',async()=>{
  const f=earningsFirestore(),rows=disclosures(2);
  const winner={...rows[0],collected_at:'2026-01-03',processed_at:'2026-01-04',baseline:true};
  f.beforeCommit(()=>f.rows.set(`events/${rows[0].id}`,winner));
  assert.equal(await saveDisclosures(f.db,rows,at,false),1);
  assert.deepEqual(f.rows.get(`events/${rows[0].id}`),winner);
  assert(!f.writes.includes(`events/${rows[0].id}`));
  assert.equal(f.writes.filter(path=>path===feedPath).length,1);
  assert.equal(f.queries.length,2);
  const before=structuredClone([...f.rows]);
  assert.deepEqual(await Promise.all([saveDisclosures(f.db,rows,at,true),saveDisclosures(f.db,rows,at,false)]),[0,0]);
  assert.deepEqual([...f.rows],before);
});

test('disclosure failure rolls back records, change markers and feed revision together',async()=>{
  const f=earningsFirestore();f.rows.set(feedPath,{changedAt:'before'});
  const before=structuredClone([...f.rows]);f.reject(path=>path===feedPath);
  await assert.rejects(saveDisclosures(f.db,disclosures(2),at,false),/Injected Firestore commit failure/);
  assert.deepEqual([...f.rows],before);assert.equal(f.writes.length,0);
});

test('empty inputs do not read and repeated create conflicts are bounded',async()=>{
  const f=earningsFirestore();
  assert.deepEqual(await createCachedPriceBatch(f.db,[]),{created:0,existing:0});
  assert.equal(await saveDisclosures(f.db,[],at,false),0);
  await f.db.runTransaction(async tx=>assert.equal((await existingDocumentIds(tx,f.db.collection('events'),[])).size,0));
  assert.equal(f.queries.length,0);assert.equal(f.reads.length,0);
  let calls=0;const conflict=Object.assign(new Error('conflict'),{code:6});
  const db={runTransaction:async()=>{calls++;throw conflict;}} as unknown as Firestore;
  await assert.rejects(runInsertTransaction(db,async()=>0),error=>error===conflict);
  assert.equal(calls,3);
});
