import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { liveCompanyReads } from '../../src/lib/local-cache/company-directory';
import { listFundamentalsErrors } from '../../src/lib/fundamentals/admin-errors';

test('admin failures use current ledger and company records instead of a stale snapshot', async () => {
  const docs = {
    outcome: [{id:'US:AMD',get:(name:string)=>({lastError:{message:'delivery failed'},failedAt:'today'} as Record<string,unknown>)[name]}],
    manualRequired: [{id:'_batch_batch-1',get:(name:string)=>({request:{companyIds:['AMD']},lastError:{message:'batch failed'},failedAt:'today'} as Record<string,unknown>)[name]}],
  };
  const calls: string[] = [];
  const db = {collection:(collection:string)=>({where:(field:'outcome'|'manualRequired')=>({limit:(limit:number)=>({get:async()=>{
    calls.push(`${collection}:${field}:${limit}`);
    return {docs:liveCompanyReads()?docs[field]:[]};
  }})})})} as unknown as Firestore;
  const result=await listFundamentalsErrors(db);
  assert.deepEqual(calls.sort(),['company_fundamentals:manualRequired:100','company_fundamentals:outcome:100']);
  assert.deepEqual(result.errors,[
    {id:'_batch_batch-1',batchId:'batch-1',ticker:'AMD',message:'batch failed',failedAt:'today'},
    {id:'US:AMD',batchId:'batch-1',ticker:'AMD',message:'delivery failed',failedAt:'today'},
  ]);
  assert.equal(result.limit,200);
});
