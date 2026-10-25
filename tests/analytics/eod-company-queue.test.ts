import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {queueEodMaintenance,processEodMaintenance} from '../../src/lib/predictions/eod-pubsub';
import {parseEodMessage,processEodCompanyMessage,type EodMessage} from '../../src/lib/predictions/eod-company-queue';
import type {DailyEodMaintenanceResult,EodCompanyExecution,EodPrice} from '../../src/lib/predictions/eod-prices';
import {companyWorkRequest,type CompanyWorkRequest} from '../../src/lib/company-work-queue';
import {queueMarketCapRefresh,processMarketCapMessage,parseMarketCapMessage,type MarketCapMessage} from '../../src/lib/fundamentals/market-cap-queue';

test('historical replay orders dates and finishes each company barrier before advancing',async()=>{
  const f=pubsubFirestore();
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const messages:EodMessage[]=[],publish=async(message:EodMessage)=>{messages.push(message);};
  await queueEodMaintenance({market:'US',runDate:'2026-01-02',rollForward:true},f.db,publish);
  const original=messages.shift()!;
  await processEodCompanyMessage(original,f.db,f.log,publish);
  Object.assign(f.rows.get(`eod_runs/_request_${original.batchId}`)!,{dates:['2026-01-02','2026-01-05'],dateIndex:0});
  const work:string[]=[],scores:string[]=[];
  const deps={plan:async(input:{skipHistoryBackfill?:boolean})=>{assert.equal(input.skipHistoryBackfill,true);return ['US:AMD','US:MSFT'];},prepare:async()=>({}),
    run:async(input:{runDate?:string;tickers?:string[];skipHistoryBackfill?:boolean}={})=>{
      assert.equal(input.skipHistoryBackfill,true);assert.equal(input.tickers?.length,1);
      work.push(`${input.runDate}:${input.tickers![0]}`);
      return {priceLoad:{failed:0},marking:{missingPrice:0},hasMoreCandidatePredictions:false} as DailyEodMaintenanceResult;
    },finalize:async(input:{runDate?:string})=>{assert.equal(work.filter(item=>item.startsWith(input.runDate!)).length,2);scores.push(input.runDate!);return null;}};
  for(let i=0;messages.length;i++){assert.ok(i<30);await processEodCompanyMessage(messages.shift()!,f.db,f.log,publish,deps);}
  assert.deepEqual(scores,['2026-01-02','2026-01-05']);
  assert.deepEqual(work,['2026-01-02:AMD','2026-01-02:MSFT','2026-01-05:AMD','2026-01-05:MSFT']);
  assert.equal(f.rows.get(`eod_runs/_request_${original.batchId}`)?.completed,true);
});

test('daily EOD routes one company and its prepared price per task, then finalizes portfolios behind receipts',async()=>{
  const f=pubsubFirestore();
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const published:EodMessage[]=[];const publish=async(message:EodMessage)=>{published.push(message);};
  await queueEodMaintenance({market:'CN_A',runDate:'2026-01-02'},f.db,publish);
  const original=published[0];assert.equal(original.type,'eod.maintenance.requested');
  let root:EodMessage=original;
  const executions:EodCompanyExecution[]=[],scopes:string[][]=[];
  let scores=0,fail=true;
  const deps={
    plan:async()=>['XSHG:600000','XSHE:000001'],
    prepare:async()=>({'XSHG:600000':{price:{ticker:'XSHG:600000'} as EodPrice},'XSHE:000001':{}}),
    run:async(input:{tickers?:string[]}={},execution?:EodCompanyExecution)=>{
      assert.ok(execution,'company stage defers portfolio scores');executions.push(execution);scopes.push(input.tickers!);
      return {priceLoad:{failed:fail&&input.tickers?.[0]==='XSHE:000001'?1:0},marking:{missingPrice:0},hasMoreCandidatePredictions:false} as DailyEodMaintenanceResult;
    },
    finalize:async()=>{scores++;return null;},
  };
  const deliver=(message:EodMessage)=>processEodCompanyMessage(message,f.db,f.log,publish,deps);
  await deliver(original);
  root=published.at(-1)!;
  assert.equal(root.type,'eod.company-run.requested');
  await assert.rejects(processEodMaintenance(original as Parameters<typeof processEodMaintenance>[0],f.db,f.log),/Unknown or conflicting EOD request/);
  await deliver(root);
  const tasks=published.filter((message):message is CompanyWorkRequest=>message.type==='company.work.requested').sort((a,b)=>a.companyId==='XSHG:600000'?-1:b.companyId==='XSHG:600000'?1:0);
  assert.equal(tasks.length,2);
  await deliver(tasks[0]);await assert.rejects(deliver(tasks[1]),/incomplete/);
  await deliver(root);assert.equal(scores,0);
  assert.notEqual(f.rows.get('eod_runs/CN_A_2026-01-02')?.status,'COMPLETED');
  fail=false;await deliver(tasks[1]);await deliver(root);
  assert.equal(scores,1);
  assert.equal(f.rows.get('eod_runs/CN_A_2026-01-02')?.status,'COMPLETED');
  assert.ok([...f.rows].filter(([path])=>path.startsWith('eod_runs/_dispatch_')).every(([,data])=>data.activeRequest===null));
  assert.deepEqual(scopes,[['XSHG:600000'],['XSHE:000001'],['XSHE:000001']]);
  assert.equal(executions[0].price?.ticker,'XSHG:600000');
  assert.equal(executions[1].price,undefined,'missing bulk row is repaired inside only its company task');
  assert.throws(()=>parseEodMessage(companyWorkRequest('us-market-cap',{batchId:'a',requestedAt:'2026-01-01'},'US:AMD')),/Invalid/);
});

test('US market caps queue individual companies, reuse publication identities and exclude active SEC refreshes',async()=>{
  const f=pubsubFirestore();
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const published:MarketCapMessage[]=[],symbols:string[][]=[];
  const publish=async(message:MarketCapMessage)=>{published.push(message);};
  const one=await queueMarketCapRefresh(f.db,'execution-1',['AMD','MSFT'],'unused',publish);
  const two=await queueMarketCapRefresh(f.db,'execution-1',['MSFT','AMD'],'unused',publish);
  assert.equal(one.batchId,two.batchId);
  const root=published[0];
  const refresh=async(_db:unknown,_log:unknown,tickers:string[])=>{symbols.push(tickers);return {processed:1,failed:0};};
  const deliver=(message:MarketCapMessage)=>processMarketCapMessage(message,f.db,f.log,publish,refresh);
  await deliver(root);
  const tasks=published.filter((message):message is CompanyWorkRequest=>message.type==='company.work.requested');
  f.rows.set('company_fundamentals/_worker',{leaseOwner:'sec',leaseExpiresAtMs:Date.now()+60_000});
  await assert.rejects(deliver(tasks[0]),/Fundamentals refresh is active/);
  assert.deepEqual(symbols,[]);
  f.rows.delete('company_fundamentals/_worker');
  await deliver(tasks[0]);await deliver(tasks[0]);await deliver(tasks[1]);await deliver(root);
  assert.deepEqual(symbols,[['AMD'],['MSFT']]);
  assert.equal(f.rows.get(`company_fundamentals/_marketcap_${one.batchId}`)?.completed,true);
  assert.throws(()=>parseMarketCapMessage({...root,type:'unknown'}),/Invalid/);
});

test('an interrupted protocol upgrade republishes the same new request without running legacy company work',async()=>{
  const f=pubsubFirestore(),messages:EodMessage[]=[];
  await queueEodMaintenance({market:'US',runDate:'2026-01-02'},f.db,async message=>{messages.push(message);});
  const original=messages[0];
  f.rows.set('eod_runs/_queue_US',{leaseOwner:'old-revision',leaseExpiresAtMs:Date.now()+60_000});
  await assert.rejects(processEodCompanyMessage(original,f.db,f.log,async()=>{}),/Legacy EOD delivery is still active/);
  assert.equal((f.rows.get(`eod_runs/_request_${original.batchId}`)?.request as {version:number}).version,1);
  f.rows.delete('eod_runs/_queue_US');
  await assert.rejects(processEodCompanyMessage(original,f.db,f.log,async()=>{throw Error('publish failed');}),/publish failed/);
  const saved=f.rows.get(`eod_runs/_request_${original.batchId}`)?.request;
  assert.equal((saved as {version:number}).version,2);
  await processEodCompanyMessage(original,f.db,f.log,async message=>{messages.push(message);});
  assert.deepEqual(messages.at(-1),saved);
  assert.equal(f.rows.get(`eod_runs/_request_${original.batchId}`)?.companyIds,undefined);
});
