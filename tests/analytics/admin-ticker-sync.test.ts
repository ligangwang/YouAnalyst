import {test} from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {runTickerResponse,tickerSyncInput} from "../../src/lib/admin-jobs/tickers";
import {loadJobHistory,type CloudRequest} from "../../src/lib/admin-jobs/service";
import {reserveWorkerDispatch,runWorkerResponse} from "../../src/lib/admin-jobs/run-sec";

test("ticker sync requires admin authorization and explicit validated mode",async()=>{
  let runs=0;
  const req=(body:unknown)=>new NextRequest('https://example.test/api/admin/jobs/tickers',{method:'POST',body:JSON.stringify(body)});
  const deps={getUser:async()=>({uid:'admin'}) as never,isAdmin:async()=>true,run:async(input:ReturnType<typeof tickerSyncInput>,uid:string)=>{runs++;assert.equal(uid,'admin');return {dryRun:input.dryRun} as never;}};
  assert.equal((await runTickerResponse(req({dryRun:false}),{...deps,getUser:async()=>null})).status,401);
  assert.equal((await runTickerResponse(req({dryRun:false}),{...deps,isAdmin:async()=>false})).status,403);
  for(const body of [{},{dryRun:'false'},{dryRun:true,limit:-1},{dryRun:true,types:['']},{dryRun:true,currency:'bad-code'}]) assert.equal((await runTickerResponse(req(body),deps)).status,400);
  assert.equal(runs,0);
  for(const dryRun of [true,false]) {
    const response=await runTickerResponse(req({dryRun}),deps);
    assert.equal(response.status,200);assert.equal((await response.json()).dryRun,dryRun);
  }
  const failure=await runTickerResponse(req({dryRun:false}),{...deps,run:async()=>{throw Error('private credential detail');}});
  assert.equal(failure.status,502);assert.ok(!JSON.stringify(await failure.json()).includes('credential'));
  assert.equal((await runTickerResponse(req({dryRun:false}),{...deps,run:async()=>{throw Object.assign(Error('busy'),{code:'ALREADY_RUNNING'});}})).status,409);
});

test("directory dispatch uses the existing import lease and blocks duplicate requests",async()=>{
  const paths:string[]=[];let stored:Record<string,unknown>={};
  const db={collection:(name:string)=>({doc:(id:string)=>{paths.push(`${name}/${id}`);return {};}}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:async()=>({data:()=>stored}),set:(_ref:unknown,data:Record<string,unknown>)=>{stored={...stored,...data};}})} as unknown as Parameters<typeof reserveWorkerDispatch>[0];
  await reserveWorkerDispatch(db,'admin',1000,'directory');
  assert.deepEqual(paths,['directory_syncs/CN_A_CNI']);
  await assert.rejects(reserveWorkerDispatch(db,'admin',1001,'directory'),{code:'ALREADY_RUNNING'});
  let calls=0;const deps={getUser:async()=>({uid:'user'}) as never,isAdmin:async()=>false,start:async()=>{calls++;return {operation:'op'};}};
  const response=await runWorkerResponse('directory',new NextRequest('https://example.test',{method:'POST'}),deps);
  assert.equal(response.status,403);assert.equal(calls,0);
});

test("ticker history joins its own run logs without a market or scheduler filter",async()=>{
  const filters:string[]=[];
  const request:CloudRequest=async<T>(_url:string,data?:unknown)=>{
    const filter=(data as {filter:string}).filter;filters.push(filter);
    return {entries:[{timestamp:'2026-09-27T00:00:00Z',jsonPayload:filter.includes('run_started')?{runId:'r1'}:{runId:'r1',message:'sync-tickers: run_completed',written:10}}]} as T;
  };
  const page=await loadJobHistory({job:'tickers',view:'runs'},request,'project');
  assert.equal(page.records[0].status,'Succeeded');assert.equal(page.records[0].summary.written,10);
  assert.ok(filters.every(f=>!f.includes('jsonPayload.market')));assert.ok(filters[0].includes('sync-tickers: run_started'));
  await loadJobHistory({job:'tickers',view:'scheduler'},async()=>{throw Error('must not query');},'project');
});
