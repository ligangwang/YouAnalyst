import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withSecBulkFinancialReads,scopedSecFinancialJson} from '../../src/lib/fundamentals/sec-bulk-scope';
import type {SecBulkReader,SecBulkSnapshot} from '../../src/lib/fundamentals/sec-bulk';
const url='https://data.sec.gov/api/xbrl/companyfacts/CIK0000002488.json';
function fixture(){
  const snapshot:SecBulkSnapshot={version:1,id:'2026-10-25-1234567890abcdef',capturedAt:new Date().toISOString(),companyIds:['US:AMD'],ciks:['0000002488']};
  let reads=0,live=0;
  const reader:SecBulkReader={latest:async()=>snapshot,read:async()=>{reads++;return {cik:2488};}};
  const work=()=>scopedSecFinancialJson(url,async()=>{live++;return {live:true};});
  return {snapshot,reader,work,counts:()=>({reads,live})};
}
test('scheduled company reads use pinned JSON while nested incremental filing work stays live',async()=>{
  const f=fixture();await withSecBulkFinancialReads({companyIds:['AMD']},async()=>{
    assert.deepEqual(await f.work(),{cik:2488});
    assert.deepEqual(await withSecBulkFinancialReads({companyIds:['AMD'],incremental:true},f.work,f.reader),{live:true});
  },f.reader);assert.deepEqual(f.counts(),{reads:1,live:1});
});

test('verification and nested out-of-snapshot work clear the bulk scope; missing selected JSON never fans out live',async()=>{
  const f=fixture();
  await withSecBulkFinancialReads({companyIds:['AMD']},async()=>{
    assert.deepEqual(await withSecBulkFinancialReads({companyIds:['AMD'],verification:true},f.work,f.reader),{live:true});
    assert.deepEqual(await withSecBulkFinancialReads({companyIds:['MSFT']},f.work,f.reader),{live:true});
    assert.deepEqual(await f.work(),{cik:2488},'outer pinned snapshot survives nested work');
  },f.reader);
  assert.deepEqual(f.counts(),{reads:1,live:2});
  await assert.rejects(withSecBulkFinancialReads({companyIds:['AMD']},f.work,{...f.reader,read:async()=>null}),/missing/);
  assert.deepEqual(f.counts(),{reads:1,live:2},'a missing selected object does not invoke live fallback');
});
test('stale published snapshots stop before company mutation; additive rollout and new issuers retain bounded live path',async()=>{
  const f=fixture();f.snapshot.capturedAt='2000-01-01T00:00:00Z';
  await assert.rejects(withSecBulkFinancialReads({companyIds:['AMD']},f.work,f.reader),/stale/);assert.deepEqual(f.counts(),{reads:0,live:0});
  f.snapshot.capturedAt=new Date().toISOString();await withSecBulkFinancialReads({companyIds:['MSFT']},f.work,f.reader);
  await withSecBulkFinancialReads({companyIds:['AMD']},f.work,{...f.reader,latest:async()=>null});
  assert.deepEqual(f.counts(),{reads:0,live:2});
});
