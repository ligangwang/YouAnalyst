import type {Firestore} from 'firebase-admin/firestore';
import {parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../company-work-queue';
import {publishJobMessage} from '../job-pubsub';
import {digest} from '../fundamentals/pubsub';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import type {MaintenanceLog} from '../maintenance-log';
import {parseEodRequest,processEodMaintenance,type EodRequest} from './eod-pubsub';
import {planEodCompanyWork,prepareEodCompanyPrices,finalizeEodCompanyScores,runDailyEodMaintenance,type EodPrice} from './eod-prices';

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
  if(message.type==='company.work.requested')return processCompanyWork<EodCompanyRunRequest>(message,{
    db,parent:parentRef(db,message.parentBatchId),state,collection:'eod_runs',owner:log.runId,publish,
    work:async(parent,prepared,cursor)=>{
      const input=parent.input,market=input.market,ticker=market==='US'?message.companyId.slice(3):message.companyId;
      const result=await (dependencies.run??runDailyEodMaintenance)({...input,rollForward:false,tickers:[ticker],afterPredictionId:cursor??undefined},
        {taskId:message.batchId,...(prepared.price?{price:prepared.price as EodPrice}:{})});
      if(result.priceLoad.failed||result.marking.missingPrice||result.corporateActions?.failures.length||result.corporateActions?.deferred)throw Error('Company EOD processing remains incomplete');
      if(result.hasMoreCandidatePredictions&&(!result.nextPredictionId||result.nextPredictionId===cursor))throw Error('Company prediction cursor did not advance');
      return result.hasMoreCandidatePredictions?result.nextPredictionId!:null;
    },
  });
  const ref=parentRef(db,message.batchId),prior=(await ref.get()).data();
  // Finish requests already checkpointed by the old worker and historical replays
  // through their original path. Ordinary new daily requests use company receipts.
  if(message.type==='eod.maintenance.requested'){
    if(message.input.rollForward||prior?.dates)return processEodMaintenance(message,db,log);
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
  const input=message.input;
  return processCompanyRun(message,{
    db,ref,state,collection:'eod_runs',kind:'eod',owner:log.runId,publish,
    plan:async()=>{
      for(const key of [`_active_${input.market}`,`_queue_${input.market}`])
        if(Number((await db.collection('eod_runs').doc(key).get()).get('leaseExpiresAtMs'))>Date.now())throw Error('Legacy EOD delivery is still active');
      const ids=await (dependencies.plan??planEodCompanyWork)(input,db);
      await db.collection('eod_runs').doc(`${input.market}_${input.runDate}`).set({status:'STARTED',market:input.market,runDate:input.runDate},{merge:true});
      return ids;
    },
    prepare:ids=>(dependencies.prepare??prepareEodCompanyPrices)(input,ids),
    finalize:async cursor=>{
      const next=await (dependencies.finalize??finalizeEodCompanyScores)(input,cursor,db);
      if(next===null){
        await db.collection('eod_runs').doc(`${input.market}_${input.runDate}`).set({status:'COMPLETED',completedAt:new Date().toISOString(),error:null},{merge:true});
        const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(input)}`);
        await db.runTransaction(async tx=>{
          if((await tx.get(dispatch)).get('activeRequest')?.batchId===message.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
        });
      }
      return next;
    },
  });
}
