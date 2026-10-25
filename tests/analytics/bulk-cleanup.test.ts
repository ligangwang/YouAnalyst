import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bulkStorage} from '../helpers/bulk-storage';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {cleanSecBulkFiles,cleanEodBulkFiles} from '../../src/lib/fundamentals/bulk-cleanup';
import {publishSecBulkSnapshot} from '../../src/lib/fundamentals/sec-bulk-storage';
import type {SecBulkSnapshot} from '../../src/lib/fundamentals/sec-bulk';
const old='sec-financial-bulk/v1/snapshots/2026-10-01-1234567890abcdef/';
const held='sec-financial-bulk/v1/snapshots/2026-10-02-1234567890abcdef/';
const snapshot:SecBulkSnapshot={version:1,id:'2026-10-25-1234567890abcdef',capturedAt:new Date().toISOString(),companyIds:['US:AMD'],ciks:['0000002488']};

test('SEC cleanup retains latest snapshot, extraction holds and unrelated prefixes; raw and derived old files expire',async()=>{
  const f=bulkStorage();await publishSecBulkSnapshot(f.value,snapshot,0);
  for(const [name,hold] of [[old+'companyfacts.zip',false],[old+'companyfacts/CIK0000002488.json',false],[held+'companyfacts.zip',true],[held+'submissions/CIK0000002488.json',false],['eod_prices/history.json',false]] as const)await f.value.file(name).save('{}',{metadata:{temporaryHold:hold}});
  const before=f.rows.size,now=Date.now()+8*86400_000;
  await cleanSecBulkFiles(f.value,{apply:false,now});assert.equal(f.rows.size,before);
  const result=await cleanSecBulkFiles(f.value,{apply:true,now});assert.equal(result.deleted,2);
  assert.ok(!f.rows.has(old+'companyfacts.zip'));assert.ok(!f.rows.has(old+'companyfacts/CIK0000002488.json'));
  assert.ok(f.rows.has(held+'submissions/CIK0000002488.json'));assert.ok(f.rows.has('sec-financial-bulk/v1/latest.json'));assert.ok(f.rows.has('eod_prices/history.json'));
});
test('EOD cleanup excludes active company runs and legacy leases, then releases all cleanup leases',async()=>{
  const f=bulkStorage(),db=pubsubFirestore();await f.value.file('eodhd-bulk-eod/US/2026-10-01.json').save('{}');
  const now=Date.now()+8*86400_000;
  db.rows.set('eod_runs/_company_pipeline',{activeRequest:{batchId:'active'}});
  assert.equal((await cleanEodBulkFiles(db.db,f.value,{apply:true,now})).skipped,true);
  db.rows.set('eod_runs/_company_pipeline',{activeRequest:null});db.rows.set('eod_runs/_queue_US',{leaseOwner:'legacy',leaseExpiresAtMs:Date.now()+60000});
  assert.equal((await cleanEodBulkFiles(db.db,f.value,{apply:true,now})).skipped,true);
  db.rows.delete('eod_runs/_queue_US');
  assert.equal((await cleanEodBulkFiles(db.db,f.value,{apply:true,now})).deleted,1);
  assert.equal(f.rows.size,0);
  assert.ok([...db.rows.values()].every(row=>typeof row.leaseOwner!=='string'),'cleanup does not leave the queues locked');
});
