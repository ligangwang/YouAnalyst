import type {Firestore} from 'firebase-admin/firestore';
import {parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../company-work-queue';
import {publishJobMessage} from '../job-pubsub';
import {digest} from '../fundamentals/pubsub';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import type {MaintenanceLog} from '../maintenance-log';
import {parseEodRequest,processEodMaintenance,type EodRequest} from './eod-pubsub';
import {planEodCompanyWork,prepareEodCompanyPrices,finalizeEodCompanyScores,runDailyEodMaintenance,readRollForwardDates,type EodPrice} from './eod-prices';
import {retireExpiredEodRun} from './eod-recovery';

export type EodCompanyRunRequest=Omit<EodRequest,'version'|'type'>&{version:2;type:'eod.company-run.requested'};
export type EodMessage=EodRequest|EodCompanyRunRequest|CompanyWorkRequest;
export function parseEodMessage(value:unknown):EodMessage {
  if((value as {type?:string})?.type==='company.work.requested')return parseCompanyWorkRequest(value,'eod');
  if((value as {type?:string})?.type==='eod.company-run.requested'){
    if((value as {version?:number}).version!==2)throw Error('Invalid company EOD protocol');
    return {...parseEodRequest({...value as EodCompanyRunRequest,version:1,type:'eod.maintenance.requested'}),version:2,type:'eod.company-run.requested'};
  }
  return parseEodRequest(value);
}
const parentRef=(db:Firestore,id:string)=>db.collection('eod_runs').doc(`_request_${id}`);
export async function processEodCompanyMessage(value:EodMessage,db:Firestore,log:MaintenanceLog,
  publish:(message:EodMessage)=>Promise<unknown>=message=>publishJobMessage(process.env.EOD_REQUEST_TOPIC||'eod-maintenance-requests',message),
  dependencies:{plan?:typeof planEodCompanyWork;prepare?:typeof prepareEodCompanyPrices;run?:typeof runDailyEodMaintenance;finalize?:typeof finalizeEodCompanyScores}={}){
  const message=parseEodMessage(value),state=db.collection('eod_runs').doc('_company_pipeline');
  if(message.type==='company.work.requested'){
    // Retired failed runs retain incomplete receipts; late deliveries must not
    // mutate predictions after a later date has started or loop in Pub/Sub.
    const retired=await parentRef(db,message.parentBatchId).get();
    if(retired.get('completed')===true&&retired.get('status')==='FAILED')return {batchId:message.batchId,status:'FAILED',retired:true};
    return processCompanyWork<EodCompanyRunRequest>(message,{
    db,parent:parentRef(db,message.parentBatchId),state,collection:'eod_runs',owner:log.runId,publish,
    work:async(parent,prepared,cursor)=>{
      const replay=(await parentRef(db,parent.batchId).get()).get('result')?.parentRequest;
      const input={...parent.input,...(replay?{skipHistoryBackfill:true}:{})},market=input.market,ticker=market==='US'?message.companyId.slice(3):message.companyId;
      const result=await (dependencies.run??runDailyEodMaintenance)({...input,rollForward:false,tickers:[ticker],afterPredictionId:cursor??undefined},
        {taskId:message.batchId,...(prepared.price?{price:prepared.price as EodPrice}:{})});
      if(result.priceLoad.failed||result.marking.missingPrice||result.corporateActions?.failures.length||result.corporateActions?.deferred)throw Error('Company EOD processing remains incomplete');
      if(result.hasMoreCandidatePredictions&&(!result.nextPredictionId||result.nextPredictionId===cursor))throw Error('Company prediction cursor did not advance');
      return result.hasMoreCandidatePredictions?result.nextPredictionId!:null;
    },
    });
  }
  const retired=await retireExpiredEodRun(db);
  if(retired)log.emit('ERROR','company_run_retired',{batchId:retired,status:'FAILED',reason:'Company recovery window expired; receipts retained'});
  const ref=parentRef(db,message.batchId),prior=(await ref.get()).data();
  // Finish already checkpointed old requests through their original path.
  // New daily requests and historical replays use company receipts.
  if(message.type==='eod.maintenance.requested'){
    if(prior?.dates&&prior.request?.type==='eod.maintenance.requested')return processEodMaintenance(message,db,log);
    // Persist the new protocol before publication. Old workers compare the stored
    // request digest and reject a replay of the old message instead of finalizing.
    const legacyLease=db.collection('eod_runs').doc(`_queue_${message.input.market}`);
    if(!await acquireMaintenanceLease(legacyLease,log.runId))throw Error('Legacy EOD delivery is still active');
    let upgraded:EodCompanyRunRequest|null;
    try{
      upgraded=await db.runTransaction(async tx=>{
        const saved=(await tx.get(ref)).data();
        if(saved?.request?.type==='eod.company-run.requested')return parseEodMessage(saved.request) as EodCompanyRunRequest;
        if(!saved?.request||digest(saved.request)!==digest(message))throw Error('Unknown EOD upgrade request');
        if(saved.dates)return null;
        const request:EodCompanyRunRequest={...message,version:2,type:'eod.company-run.requested'};
        tx.set(ref,{request},{merge:true});return request;
      });
    }finally{await releaseMaintenanceLease(legacyLease,log.runId);}
    if(!upgraded)return processEodMaintenance(message,db,log);
    await publish(upgraded);return {batchId:message.batchId,upgraded:true};
  }
  if(prior?.completed){
    const parentRequest=prior.result?.parentRequest;
    if(parentRequest)await publish(parseEodMessage(parentRequest));
    return {batchId:message.batchId,duplicate:true,...(prior.status==='FAILED'?{status:'FAILED'}:{})};
  }
  if(message.input.rollForward)return processEodReplay(message,db,log,publish);
  const active=(await state.get()).get('activeRequest');
  if(active&&active.batchId!==message.batchId){
    // Repair a lost parent/finalizer wakeup as later scheduled work arrives.
    // Publishing is idempotent; the existing leases and receipts fence duplicates.
    await publish(parseEodMessage(active));
    throw Error('Previous company run is unfinished; recovery requested');
  }
  const input={...message.input,...(prior?.result?.parentRequest?{skipHistoryBackfill:true}:{})};
  const outcome=await processCompanyRun(message,{
    db,ref,state,collection:'eod_runs',kind:'eod',owner:log.runId,publish,
    plan:async()=>{
      for(const key of [`_active_${input.market}`,`_queue_${input.market}`])
        if(Number((await db.collection('eod_runs').doc(key).get()).get('leaseExpiresAtMs'))>Date.now())throw Error('Legacy EOD delivery is still active');
      const ids=await (dependencies.plan??planEodCompanyWork)(input,db);
      // Start the recovery window when work begins, not when an old queued date
      // was requested. Catch-up runs deserve the same retry budget as new runs.
      await ref.set({startedAt:new Date().toISOString()},{merge:true});
      await db.collection('eod_runs').doc(`${input.market}_${input.runDate}`).set({status:'STARTED',market:input.market,runDate:input.runDate},{merge:true});
      return ids;
    },
    prepare:ids=>(dependencies.prepare??prepareEodCompanyPrices)(input,ids),
    finalize:async cursor=>{
      const next=await (dependencies.finalize??finalizeEodCompanyScores)(input,cursor,db);
      if(next===null){
        await db.collection('eod_runs').doc(`${input.market}_${input.runDate}`).set({status:'COMPLETED',completedAt:new Date().toISOString(),error:null},{merge:true});
        const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(message.input)}`);
        await db.runTransaction(async tx=>{
          if((await tx.get(dispatch)).get('activeRequest')?.batchId===message.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
        });
      }
      return next;
    },
  });
  // Keep a durable Pub/Sub wakeup until either all receipts finish or recovery
  // retires the run. A child exhausted into the DLQ must not orphan its parent.
  if(outcome.phase==='waiting'&&'completed' in outcome&&outcome.completed!==outcome.required)
    throw Error('EOD is waiting for company receipts; retry recovery wakeup');
  if(outcome.phase==='completed'||outcome.duplicate){
    const finished=await ref.get();
    const parentRequest=finished.get('result')?.parentRequest;
    if(parentRequest)await publish(parseEodMessage(parentRequest));
    if(finished.get('status')==='FAILED')return {...outcome,status:'FAILED'};
  }
  return outcome;
}

/** Historical dates remain ordered; each date uses the same company barrier. */
async function processEodReplay(request:EodCompanyRunRequest,db:Firestore,log:MaintenanceLog,publish:(message:EodMessage)=>Promise<unknown>){
  const ref=parentRef(db,request.batchId);
  if(!await acquireMaintenanceLease(ref,log.runId))throw Error('EOD replay is busy');
  try{
    let saved=(await ref.get()).data();
    if(!saved?.request||digest(saved.request)!==digest(request))throw Error('Unknown EOD replay');
    if(saved.completed)return {duplicate:true,batchId:request.batchId};
    if(!saved.dates){
      const count=request.input.rollForwardBatchSize??5,dates=await readRollForwardDates(db,request.input.runDate,count+1);
      await ref.set({dates:dates.slice(0,count),nextRunDate:dates[count]??null,dateIndex:0},{merge:true});saved=(await ref.get()).data()!;
    }
    if(saved.dateIndex>=saved.dates.length){
      if(!saved.dates.length)throw Error('No EOD replay dates found');
      const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(request.input)}`);
      await db.runTransaction(async tx=>{
        const active=(await tx.get(dispatch)).get('activeRequest');
        tx.set(ref,{completed:true,completedAt:new Date().toISOString()},{merge:true});
        if(active?.batchId===request.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
      });return {completed:true,batchId:request.batchId};
    }
    const date=saved.dates[saved.dateIndex],batchId=digest({replay:request.batchId,date}),child=parentRef(db,batchId);
    const childRun=await child.get();
    if(childRun.get('completed')===true&&childRun.get('status')==='FAILED'){
      // A failed historical date must not masquerade as a successful replay.
      const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(request.input)}`);
      await db.runTransaction(async tx=>{
        const active=(await tx.get(dispatch)).get('activeRequest');
        tx.set(ref,{completed:true,status:'FAILED',error:`EOD replay stopped at incomplete date ${date}`,failedAt:new Date().toISOString()},{merge:true});
        if(active?.batchId===request.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
      });
      return {batchId:request.batchId,status:'FAILED'};
    }
    if(childRun.get('completed')===true){
      await ref.set({dateIndex:saved.dateIndex+1},{merge:true});await publish(request);return {advanced:true,batchId:request.batchId};
    }
    const daily:EodCompanyRunRequest={...request,batchId,input:{...request.input,runDate:date,rollForward:false}};
    await db.runTransaction(async tx=>{if(!(await tx.get(child)).exists)tx.create(child,{request:daily,result:{parentRequest:request}});});
    await publish(daily);return {waiting:true,batchId:request.batchId};
  }finally{await releaseMaintenanceLease(ref,log.runId);}
}
