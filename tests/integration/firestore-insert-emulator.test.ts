// Run against a local emulator:
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 npx tsx --test tests/integration/firestore-insert-emulator.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore, type Transaction } from '@google-cloud/firestore';
import { saveDisclosures } from '../../src/lib/events/disclosure-store';
import { secDisclosureRows } from '../../src/lib/events/disclosures';
import { FEED_CHANGE_FIELD, FEED_REVISION_DOCUMENT } from '../../src/lib/intelligence/feed-cache-changes';

const host=process.env.FIRESTORE_EMULATOR_HOST;
// Never connect this test to a production database, even with ADC available.
if(host&&!/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw Error('Local Firestore emulator required');
const emulatorTest=host?test:test.skip;
const at='2026-10-28T12:00:00Z';
function client(){return new Firestore({projectId:`demo-insert-${randomUUID().slice(0,8)}`});}
function disclosures(count:number){return secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent:{
  accessionNumber:Array.from({length:count},(_,i)=>`0000723125-26-${String(i+1).padStart(6,'0')}`),
  form:Array(count).fill('4'),filingDate:Array(count).fill('2026-01-02'),primaryDocument:Array(count).fill('filing.xml'),
}}});}

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
  // Execute all production reads/writes on a real SDK Transaction, then abort
  // before commit. No in-memory fixture can accidentally publish staged writes.
  const failing=new Proxy(db,{get(target,prop){
    if(prop==='runTransaction')return (work:(tx:Transaction)=>Promise<unknown>)=>target.runTransaction(async tx=>{
      await work(tx);throw Error('Injected abort before commit');
    });
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;
  }});
  await assert.rejects(saveDisclosures(failing,disclosures(2),at,false),/Injected abort/);
  assert((await db.collection('events').get()).empty);
  assert(!(await db.collection('collectors').doc(FEED_REVISION_DOCUMENT).get()).exists);
});
