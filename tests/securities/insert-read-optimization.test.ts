import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { earningsFirestore } from '../helpers/earnings-firestore';
import { existingDocumentIds, runInsertTransaction } from '../../src/lib/firebase/insert-transaction';
import { createCachedPriceBatch } from '../../src/lib/intelligence/price-cache';
import { saveDisclosures } from '../../src/lib/events/disclosure-store';
import { secDisclosureRows } from '../../src/lib/events/disclosures';
import { FEED_CHANGE_FIELD, FEED_REVISION_DOCUMENT } from '../../src/lib/intelligence/feed-cache-changes';

const feedPath=`collectors/${FEED_REVISION_DOCUMENT}`;
function disclosures(count:number){
  return secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent:{
    accessionNumber:Array.from({length:count},(_,i)=>`0000723125-26-${String(i+1).padStart(6,'0')}`),
    form:Array(count).fill('4'),filingDate:Array(count).fill('2026-01-02'),primaryDocument:Array(count).fill('filing.xml'),
  }}});
}
const at='2026-10-28T12:00:00Z';

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
