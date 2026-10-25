import type {Firestore} from 'firebase-admin/firestore';
import {parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../company-work-queue';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import type {MaintenanceLog} from '../maintenance-log';
import {publishJobMessage} from '../job-pubsub';
import {digest} from './pubsub';
import {refreshCompanyMarketCaps} from './market-cap';
import {FUNDAMENTALS_COLLECTION} from './service';
import {usFundamentalsTicker} from './identity';

export type MarketCapRunRequest={version:1;type:'market-cap.refresh.requested';batchId:string;requestedAt:string};
export type MarketCapMessage=MarketCapRunRequest|CompanyWorkRequest;
const parentRef=(db:Firestore,id:string)=>db.collection(FUNDAMENTALS_COLLECTION).doc(`_marketcap_${id}`);
export function parseMarketCapMessage(value:unknown):MarketCapMessage {
  if((value as {type?:string})?.type==='company.work.requested')return parseCompanyWorkRequest(value,'us-market-cap');
  const v=value as MarketCapRunRequest;
  if(!v||v.version!==1||v.type!=='market-cap.refresh.requested'||typeof v.batchId!=='string'||!/^[\w-]{1,100}$/.test(v.batchId)||typeof v.requestedAt!=='string'||!Number.isFinite(Date.parse(v.requestedAt)))throw Error('Invalid market-cap run');
  return {version:1,type:v.type,batchId:v.batchId,requestedAt:v.requestedAt};
}
export async function queueMarketCapRefresh(db:Firestore,execution:string,tickers:string[],topic:string,
  publish:(message:MarketCapMessage)=>Promise<unknown>=message=>publishJobMessage(topic,message)) {
  const companyIds=[...new Set(tickers.map(ticker=>`US:${ticker}`))].sort();
  if(companyIds.some(id=>usFundamentalsTicker(id)===null)||Buffer.byteLength(JSON.stringify(companyIds))>500_000)throw Error('Invalid market-cap company scope');
  const ref=parentRef(db,digest({execution,kind:'market-cap'}));
  const request=await db.runTransaction(async tx=>{
    const old=(await tx.get(ref)).data();
    if(old){if(digest(old.companyIds)!==digest(companyIds))throw Error('Market-cap run scope changed');return parseMarketCapMessage(old.request) as MarketCapRunRequest;}
    const request:MarketCapRunRequest={version:1,type:'market-cap.refresh.requested',batchId:ref.id.slice('_marketcap_'.length),requestedAt:new Date().toISOString()};
    tx.create(ref,{request,companyIds,phase:'companies',dispatchCursor:0,completedCompanies:0});
    return request;
  });
  await publish(request);
  return {queued:true,requested:companyIds.length,batchId:request.batchId};
}
export async function processMarketCapMessage(value:MarketCapMessage,db:Firestore,log:MaintenanceLog,
  publish:(message:MarketCapMessage)=>Promise<unknown>=message=>publishJobMessage(process.env.FUNDAMENTALS_REQUEST_TOPIC||'sec-fundamentals-requests',message),
  refresh=refreshCompanyMarketCaps){
  const request=parseMarketCapMessage(value),state=db.collection(FUNDAMENTALS_COLLECTION).doc('_marketcap_pipeline');
  if(request.type==='company.work.requested')return processCompanyWork<MarketCapRunRequest>(request,{
    db,parent:parentRef(db,request.parentBatchId),state,collection:FUNDAMENTALS_COLLECTION,owner:log.runId,publish,
    work:async()=>{
      // Preserve exclusion with SEC refreshes while using the existing subscriber.
      const worker=db.collection(FUNDAMENTALS_COLLECTION).doc('_worker');
      if(!await acquireMaintenanceLease(worker,log.runId))throw Error('Fundamentals refresh is active');
      try{
        const result=await refresh(db,log,[usFundamentalsTicker(request.companyId)!]);
        if(result.failed)throw Error('Company market-cap refresh incomplete');
        return null;
      }finally{await releaseMaintenanceLease(worker,log.runId);}
    },
  });
  return processCompanyRun(request,{
    db,ref:parentRef(db,request.batchId),state,collection:FUNDAMENTALS_COLLECTION,kind:'us-market-cap',owner:log.runId,publish,
    plan:async()=>{throw Error('Missing frozen market-cap company manifest');},prepare:async()=>({}),finalize:async()=>null,
  });
}
