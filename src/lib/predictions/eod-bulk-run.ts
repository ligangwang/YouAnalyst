import type {Firestore} from 'firebase-admin/firestore';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import {digest} from '../fundamentals/pubsub';
import type {EodCompanyRunRequest} from './eod-company-queue';
import {completeMarketEodRun} from './latest-eod-run';
import {withEodWorkScope} from './eod-work-scope';

export const EOD_BULK_SIZE=1000;
type Run={request:EodCompanyRunRequest;batchVersion?:number;companyIds?:string[];phase?:string;dispatchCursor?:number;
  retryCompanyIds?:string[];completedCompanies?:number;cursor?:string|null;finalizeCursor?:string|null;completed?:boolean;error?:string|null};
export type BulkOptions={db:Firestore;owner:string;publish:(request:EodCompanyRunRequest)=>Promise<unknown>;
  plan:()=>Promise<string[]>;prices:(ids:string[],retry:boolean)=>Promise<string[]>;
  predictions:(cursor:string|null)=>Promise<string|null>;finalize:(cursor:string|null)=>Promise<string|null>;
  budgetMs?:number;now?:()=>number;upgradeBatchedRun?:boolean};

/** New daily runs use stage checkpoints, not one workflow per company. Existing
 * ledger fields keep rollout additive; batchVersion=1 runs keep their old route. */
export async function processBulkEodRun(request:EodCompanyRunRequest,options:BulkOptions) {
 return withEodWorkScope(async()=>{
  const {db,owner}=options,now=options.now??Date.now,deadline=now()+(options.budgetMs??240_000);
  const ref=db.collection('eod_runs').doc(`_request_${request.batchId}`),state=db.collection('eod_runs').doc('_company_pipeline');
  if(!await acquireMaintenanceLease(ref,owner))throw Error('EOD bulk run is busy');
  let wake=false;
  const checkpoint=async(patch:Partial<Run>)=>db.runTransaction(async tx=>{
    const saved=await tx.get(ref),pipeline=await tx.get(state);
    if(saved.get('leaseOwner')!==owner||Number(saved.get('leaseExpiresAtMs'))<=now()||pipeline.get('activeRequest')?.batchId!==request.batchId)throw Error('EOD bulk lease changed');
    tx.set(ref,patch,{merge:true});
  });
  try {
   const stored=(await ref.get()).data() as Run|undefined;
   if(!stored||digest(stored.request)!==digest(request))throw Error('Unknown EOD bulk request');
   let run:Run=stored;
   if(run.completed)return {batchId:request.batchId,duplicate:true};
   const upgrading=run.batchVersion===1&&options.upgradeBatchedRun===true;
   if(run.companyIds&&run.batchVersion!==2&&!upgrading)throw Error('Cannot adopt an in-flight company run');
   await db.runTransaction(async tx=>{
    const pipeline=await tx.get(state);
    const active=pipeline.get('activeRequest');
    if(Number(pipeline.get('leaseExpiresAtMs'))>now()||active&&active.batchId!==request.batchId)throw Error('Previous EOD run is unfinished');
    for(const key of [`_active_${request.input.market}`,`_queue_${request.input.market}`]){
      if(Number((await tx.get(db.collection('eod_runs').doc(key))).get('leaseExpiresAtMs'))>now())throw Error('Legacy EOD delivery is active');
    }
    tx.set(state,{activeRequest:request},{merge:true});
   });
   if(!run.companyIds||upgrading){
    // Version 1 held this same parent lease throughout each serial batch.
    // Once acquired, no old batch can still be writing. Keep its frozen scope,
    // reuse committed prices, and idempotently recheck predictions/finalization.
    const companyIds=[...new Set(run.companyIds??await options.plan())].sort();
    if(Buffer.byteLength(JSON.stringify(companyIds))>500_000)throw Error('EOD manifest exceeds supported size');
    const patch={batchVersion:2,companyIds,phase:'bulk-prices',dispatchCursor:0,retryCompanyIds:[],completedCompanies:0,cursor:null,finalizeCursor:null,error:null};
    await checkpoint(patch);run={...run,...patch};
    await ref.set({startedAt:new Date(now()).toISOString()},{merge:true});
    await db.collection('eod_runs').doc(`${request.input.market}_${request.input.runDate}`).set({status:'STARTED',market:request.input.market,runDate:request.input.runDate},{merge:true});
   }
   while(now()<deadline){
    if(run.phase==='bulk-prices'||run.phase==='bulk-retry'){
     const retry=run.phase==='bulk-retry',ids=retry?run.retryCompanyIds!:run.companyIds!,offset=run.dispatchCursor??0;
     if(offset<ids.length){
      const page=ids.slice(offset,offset+EOD_BULK_SIZE),missing=await options.prices(page,retry);
      if(new Set(missing).size!==missing.length||missing.some(id=>!page.includes(id)))throw Error('Invalid EOD missing-price result');
      const patch:Partial<Run>={dispatchCursor:offset+page.length,completedCompanies:(run.completedCompanies??0)+page.length-missing.length};
      if(!retry)patch.retryCompanyIds=[...run.retryCompanyIds!,...missing];
      await checkpoint(patch);run={...run,...patch};continue;
     }
     const patch=retry?{phase:'bulk-predictions',cursor:null}:{phase:'bulk-retry',dispatchCursor:0};
     await checkpoint(patch);run={...run,...patch};continue;
    }
    if(run.phase==='bulk-predictions'){
     const cursor=await options.predictions(run.cursor??null);
     if(cursor!==null&&cursor===run.cursor)throw Error('EOD prediction cursor did not advance');
     const patch={cursor,...(cursor===null?{phase:'bulk-finalizing'}:{})};
     await checkpoint(patch);run={...run,...patch};continue;
    }
    if(run.phase!=='bulk-finalizing')throw Error('Unknown bulk EOD phase');
    const cursor=await options.finalize(run.finalizeCursor??null);
    if(cursor!==null){
     if(cursor===run.finalizeCursor)throw Error('EOD finalization cursor did not advance');
     await checkpoint({finalizeCursor:cursor});run={...run,finalizeCursor:cursor};continue;
    }
    const missing=run.companyIds!.length-(run.completedCompanies??0);
    const error=missing?`${missing} companies have no provider bar; required prediction prices verified`:null;
    const status=missing?'COMPLETED_WITH_ERRORS':'COMPLETED';
    await db.runTransaction(async tx=>{
     const saved=await tx.get(ref),pipeline=await tx.get(state),dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(request.input)}`);
     const active=(await tx.get(dispatch)).get('activeRequest');
     if(saved.get('leaseOwner')!==owner||Number(saved.get('leaseExpiresAtMs'))<=now()||pipeline.get('activeRequest')?.batchId!==request.batchId)throw Error('EOD completion lease changed');
     await completeMarketEodRun(db,request.input.market,request.input.runDate,status,error,
       !request.input.tickers?.length&&request.input.loadPrices!==false&&!request.input.recompute&&(run!.completedCompanies??0)>0,tx);
     tx.set(ref,{completed:true,phase:'completed',status,error,completedAt:new Date(now()).toISOString()},{merge:true});
     tx.set(state,{activeRequest:null},{merge:true});
     if(active?.batchId===request.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
    });
    return {batchId:request.batchId,status,completedCompanies:run.completedCompanies,required:run.companyIds!.length};
   }
   wake=true;
   return {batchId:request.batchId,phase:run.phase,completedCompanies:run.completedCompanies,required:run.companyIds!.length};
  } catch(error) {
   // Keep the checkpoint retryable and visible. A successful continuation
   // derives its final warning from verified coverage, not a stale retry error.
   await db.runTransaction(async tx=>{
    const saved=await tx.get(ref);
    if(saved.get('leaseOwner')===owner&&saved.get('batchVersion')===2&&!saved.get('completed')){
     tx.set(ref,{error:'Bulk EOD stage incomplete; retry resumes the saved checkpoint',failedAt:new Date(now()).toISOString()},{merge:true});
    }
   });
   throw error;
  } finally {
   await releaseMaintenanceLease(ref,owner);
   if(wake)await options.publish(request);
  }
 });
}
