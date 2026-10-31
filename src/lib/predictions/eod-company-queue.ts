import type {Firestore} from 'firebase-admin/firestore';
import {parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../company-work-queue';
import {publishEodMessage} from './eod-publisher';
import {digest} from '../fundamentals/pubsub';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import type {MaintenanceLog} from '../maintenance-log';
import {parseEodRequest,processEodMaintenance,type EodRequest} from './eod-pubsub';
import {planEodCompanyWork,prepareEodCompanyPrices,finalizeEodCompanyScores,runDailyEodMaintenance,readRollForwardDates,type EodPrice} from './eod-prices';
import {retireExpiredEodRun} from './eod-recovery';
import {parseEodBatchRequest,processEodBatchedRun,processEodCompanyBatch,type EodBatchRequest} from './eod-batch-queue';

export type EodCompanyRunRequest=Omit<EodRequest,'version'|'type'>&{version:2;type:'eod.company-run.requested'};
export type EodMessage=EodRequest|EodCompanyRunRequest|CompanyWorkRequest|EodBatchRequest;
export function parseEodMessage(value:unknown):EodMessage {
  if((value as {type?:string})?.type==='eod.company-batch.requested')return parseEodBatchRequest(value);
  if((value as {type?:string})?.type==='company.work.requested')return parseCompanyWorkRequest(value,'eod');
  if((value as {type?:string})?.type==='eod.company-run.requested'){
    if((value as {version?:number}).version!==2)throw Error('Invalid company EOD protocol');
    return {...parseEodRequest({...value as EodCompanyRunRequest,version:1,type:'eod.maintenance.requested'}),version:2,type:'eod.company-run.requested'};
  }
  return parseEodRequest(value);
}
const parentRef=(db:Firestore,id:string)=>db.collection('eod_runs').doc(`_request_${id}`);
export async function processEodCompanyMessage(value:EodMessage,db:Firestore,log:MaintenanceLog,
  publish:(message:EodMessage)=>Promise<unknown>=publishEodMessage,
  dependencies:{plan?:typeof planEodCompanyWork;prepare?:typeof prepareEodCompanyPrices;run?:typeof runDailyEodMaintenance;finalize?:typeof finalizeEodCompanyScores;batching?:boolean;pause?:(ms:number)=>Promise<unknown>;budgetMs?:number}={}){
  const parsed=parseEodMessage(value),state=db.collection('eod_runs').doc('_company_pipeline');
  const batchMessage=parsed.type==='eod.company-batch.requested'?parsed:undefined;
  const message=batchMessage?parseEodMessage((await parentRef(db,batchMessage.parentBatchId).get()).get('request')):parsed;
  if(message.type==='eod.company-batch.requested')throw Error('Invalid EOD batch parent');
  const work=(message:CompanyWorkRequest)=>async(parent:EodCompanyRunRequest,prepared:Record<string,unknown>,cursor:string|null)=>{
      const replay=(await parentRef(db,parent.batchId).get()).get('result')?.parentRequest;
      const input={...parent.input,...(replay?{skipHistoryBackfill:true}:{})},market=input.market,ticker=market==='US'?message.companyId.slice(3):message.companyId;
      const result=await (dependencies.run??runDailyEodMaintenance)({...input,rollForward:false,tickers:[ticker],afterPredictionId:cursor??undefined},
        {taskId:message.batchId,...(prepared.price?{price:prepared.price as EodPrice}:{})});
      // An empty dated response is an explicit data gap, not a new price. It
      // need not hold unrelated portfolios when the entire issuer scan found
      // no predictions. Transport errors and required valuations still retry.
      if(result.priceLoad.failed>0&&result.priceLoad.failures?.length===result.priceLoad.failed
        &&result.priceLoad.failures.every(failure=>failure.reason==='eodhd_no_dated_bar')
        &&result.candidatePredictions===0&&result.marking.checked===0&&result.marking.missingPrice===0
        &&!result.hasMoreCandidatePredictions&&!result.fx?.failed
        &&!result.corporateActions?.failures.length&&!result.corporateActions?.deferred){
        const receipt=db.collection('eod_runs').doc(`_company_${message.batchId}`);
        await db.runTransaction(async tx=>{
          const saved=await tx.get(receipt);
          if(saved.get('leaseOwner')!==log.runId||Number(saved.get('leaseExpiresAtMs'))<=Date.now())throw Error('Company work lease expired');
          tx.set(receipt,{status:'NO_DATA',error:'Provider returned no dated bar; no predictions require valuation'},{merge:true});
        });
        log.emit('WARNING','company_no_dated_bar',{company:message.companyId,runDate:input.runDate});
        return null;
      }
      if(result.priceLoad.failed||result.marking.missingPrice||result.fx?.failed||result.corporateActions?.failures.length||result.corporateActions?.deferred)throw Error('Company EOD processing remains incomplete');
      if(result.hasMoreCandidatePredictions&&(!result.nextPredictionId||result.nextPredictionId===cursor))throw Error('Company prediction cursor did not advance');
      return result.hasMoreCandidatePredictions?result.nextPredictionId!:null;
  };
  if(message.type==='company.work.requested'){
    const retired=await parentRef(db,message.parentBatchId).get();
    if(retired.get('batchVersion')===1)return {batchId:message.batchId,duplicate:true};
    if(retired.get('completed')===true&&retired.get('status')==='FAILED')return {batchId:message.batchId,status:'FAILED',retired:true};
    return processCompanyWork<EodCompanyRunRequest>(message,{
      db,parent:parentRef(db,message.parentBatchId),state,collection:'eod_runs',owner:log.runId,publish,work:work(message),
    });
  }
  const retired=await retireExpiredEodRun(db,Date.now(),publish);
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
  const options={
    db,ref,state,collection:'eod_runs',kind:'eod' as const,owner:log.runId,publish,
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
    prepare:(ids:string[])=>(dependencies.prepare??prepareEodCompanyPrices)(input,ids),
    onVerified:async(statuses:Record<string,number>)=>{await ref.set({error:statuses.NO_DATA?`${statuses.NO_DATA} companies have no provider bar and no predictions requiring valuation`:null},{merge:true});},
    finalize:async(cursor:string|null)=>{
      const next=await (dependencies.finalize??finalizeEodCompanyScores)(input,cursor,db);
      if(next===null){
        const error=(await ref.get()).get('error')??null,status=error?'COMPLETED_WITH_ERRORS':'COMPLETED';
        await ref.set({status},{merge:true});
        await db.collection('eod_runs').doc(`${input.market}_${input.runDate}`).set({status,completedAt:new Date().toISOString(),error},{merge:true});
        const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(message.input)}`);
        await db.runTransaction(async tx=>{
          if((await tx.get(dispatch)).get('activeRequest')?.batchId===message.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
        });
      }
      return next;
    },
  };
  const batched=prior?.batchVersion===1||(!prior?.companyIds&&(dependencies.batching??process.env.EOD_COMPANY_BATCHES==='100'));
  const batchOptions={...options,
    work:(task:CompanyWorkRequest,parent:EodCompanyRunRequest,prepared:Record<string,unknown>,cursor:string|null)=>work(task)(parent,prepared,cursor),
    pause:dependencies.pause,budgetMs:dependencies.budgetMs};
  const outcome=batchMessage
    ? await processEodCompanyBatch(batchMessage,batchOptions)
    : batched?await processEodBatchedRun(message,batchOptions):await processCompanyRun(message,options);
  if(batched||batchMessage)log.emit('INFO','eod_batch_progress',{
    parentBatchId:message.batchId,...(batchMessage?{pass:batchMessage.pass,companies:batchMessage.companyIds.length}:{}),...outcome,
  });
  // Keep a durable Pub/Sub wakeup until either all receipts finish or recovery
  // retires the run. A child exhausted into the DLQ must not orphan its parent.
  if('phase' in outcome&&outcome.phase==='waiting'&&'completed' in outcome&&outcome.completed!==outcome.required)
    throw Error('EOD is waiting for company receipts; retry recovery wakeup');
  if(('phase' in outcome&&outcome.phase==='completed')||('duplicate' in outcome&&outcome.duplicate)){
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
