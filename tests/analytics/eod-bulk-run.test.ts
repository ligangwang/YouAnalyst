import assert from 'node:assert/strict';
import {test} from 'node:test';
import {processBulkEodRun,type BulkOptions} from '../../src/lib/predictions/eod-bulk-run';
import type {EodCompanyRunRequest} from '../../src/lib/predictions/eod-company-queue';
import {pubsubFirestore} from '../helpers/pubsub-firestore';

function fixture(count=2005){
 const f=pubsubFirestore(),request:EodCompanyRunRequest={version:2,type:'eod.company-run.requested',batchId:'bulk-test',requestedAt:'2026-11-06T21:30:00Z',input:{market:'US',runDate:'2026-11-06'}};
 const path='eod_runs/_request_bulk-test';f.rows.set(path,{request});
 const ids=Array.from({length:count},(_,i)=>`US:T${String(i).padStart(4,'0')}`);
 const pages:Array<{ids:string[];retry:boolean}>=[],stages:string[]=[],messages:EodCompanyRunRequest[]=[];
 const options:BulkOptions={db:f.db,owner:f.log.runId,plan:async()=>ids,publish:async r=>{messages.push(r);},
  prices:async(ids,retry)=>{pages.push({ids,retry});stages.push('prices');return [];},
  predictions:async()=>{stages.push('predictions');return null;},finalize:async()=>{stages.push('finalize');return null;}};
 return {...f,path,request,options,ids,pages,stages,messages,run:()=>processBulkEodRun(request,options)};
}

test('1000-symbol batches finish before predictions and one finalization, without company receipts',async()=>{
 const f=fixture();await f.run();
 assert.deepEqual(f.pages.map(p=>p.ids.length),[1000,1000,5]);
 assert.deepEqual(f.stages,['prices','prices','prices','predictions','finalize']);
 assert.equal(f.rows.get(f.path)?.completedCompanies,2005);
 assert.equal(f.rows.get('eod_runs/_latest_US')?.runDate,'2026-11-06');
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('eod_runs/_company_')&&k!=='eod_runs/_company_pipeline').length,0);
 await f.run();assert.equal(f.pages.length,3);
});

test('an interrupted price batch resumes at its last committed boundary',async()=>{
 const f=fixture();let broken=true;
 f.options.prices=async(ids,retry)=>{f.pages.push({ids,retry});if(ids[0]===f.ids[1000]&&broken)throw Error('partial commit');return [];};
 await assert.rejects(f.run(),/partial commit/);
 assert.equal(f.rows.get(f.path)?.dispatchCursor,1000);
 assert.equal(f.rows.get('eod_runs/_latest_US'),undefined);
 broken=false;await f.run();
 assert.deepEqual(f.pages.map(p=>p.ids[0]),[f.ids[0],f.ids[1000],f.ids[1000],f.ids[2000]]);
});

test('missing-only cleanup cannot finalize when a prediction needs a missing close',async()=>{
 const f=fixture(3);
 f.options.prices=async(ids,retry)=>{f.pages.push({ids,retry});return [f.ids[1]];};
 f.options.predictions=async()=>{throw Error('Required prediction EOD prices are missing');};
 await assert.rejects(f.run(),/Required prediction/);
 assert.deepEqual(f.pages.map(p=>p.ids),[f.ids,[f.ids[1]]]);
 assert.equal(f.rows.get(f.path)?.completedCompanies,2);
 assert.equal(f.rows.get('eod_runs/_latest_US'),undefined);
 assert.ok(!f.stages.includes('finalize'));
 f.options.predictions=async()=>null;await f.run();
 assert.equal(f.rows.get('eod_runs/US_2026-11-06')?.status,'COMPLETED_WITH_ERRORS');
});

test('prediction pages resume after failure and finalization is withheld',async()=>{
 const f=fixture(1);const cursors:Array<string|null>=[];let fail=true;
 f.options.predictions=async cursor=>{cursors.push(cursor);if(cursor===null)return 'p1000';if(fail)throw Error('transaction interrupted');return null;};
 await assert.rejects(f.run(),/transaction interrupted/);
 assert.equal(f.rows.get(f.path)?.cursor,'p1000');assert.equal(f.rows.get('eod_runs/_latest_US'),undefined);
 fail=false;await f.run();assert.deepEqual(cursors,[null,'p1000','p1000']);assert.equal(f.pages.length,1);
});

test('budget continuation and failed publication preserve the price cursor',async()=>{
 const f=fixture(1001);let clock=0;f.options.now=()=>clock;f.options.budgetMs=1;
 f.options.prices=async(ids,retry)=>{f.pages.push({ids,retry});clock+=2;return [];};
 f.options.publish=async()=>{throw Error('publish failed');};
 await assert.rejects(f.run(),/publish failed/);assert.equal(f.rows.get(f.path)?.dispatchCursor,1000);
 f.options.publish=async()=>{};f.options.budgetMs=100;await f.run();
 assert.deepEqual(f.pages.map(p=>p.ids.length),[1000,1]);
});

test('in-flight legacy manifests and a competing pipeline are not adopted',async()=>{
 const f=fixture(1);f.rows.set(f.path,{request:f.request,companyIds:f.ids,batchVersion:1});
 await assert.rejects(f.run(),/Cannot adopt/);
 f.rows.set(f.path,{request:f.request});f.rows.set('eod_runs/_company_pipeline',{activeRequest:{batchId:'other'}});
 await assert.rejects(f.run(),/Previous EOD/);assert.equal(f.pages.length,0);
});

test('finalization failure and lease loss cannot publish completed market status',async()=>{
 const f=fixture(1);f.options.finalize=async()=>{throw Error('score failure');};
 await assert.rejects(f.run(),/score failure/);assert.equal(f.rows.get('eod_runs/_latest_US'),undefined);
 f.options.finalize=async()=>{f.rows.set(f.path,{...f.rows.get(f.path),leaseOwner:'other'});return null;};
 await assert.rejects(f.run(),/lease changed/);assert.equal(f.rows.get('eod_runs/_latest_US'),undefined);
});

test('explicit version 1 upgrade preserves the frozen manifest and fences a live old batch',async()=>{
 const f=fixture(3);
 f.rows.set(f.path,{request:f.request,companyIds:f.ids,batchVersion:1,phase:'batch-main',dispatchCursor:2,completedCompanies:2,
   leaseOwner:'old-worker',leaseExpiresAtMs:Date.now()+60000});
 f.options.upgradeBatchedRun=true;f.options.plan=async()=>{throw Error('Must preserve manifest');};
 await assert.rejects(f.run(),/busy/);assert.equal(f.pages.length,0);
 f.rows.set(f.path,{...f.rows.get(f.path),leaseExpiresAtMs:0});await f.run();
 assert.deepEqual(f.pages.map(p=>p.ids),[f.ids]);
 assert.equal(f.rows.get(f.path)?.batchVersion,2);assert.equal(f.rows.get(f.path)?.completedCompanies,3);
});
