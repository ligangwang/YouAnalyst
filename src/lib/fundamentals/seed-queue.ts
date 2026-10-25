import type {Firestore} from 'firebase-admin/firestore';
import {parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../company-work-queue';
import {digest,publishFundamentalsMessage} from './pubsub';
import {FUNDAMENTALS_COLLECTION,requestCompanyFundamentals} from './service';
import {usFundamentalsTicker} from './identity';
import {auditMapFundamentals} from './batch';
import {publishPendingFundamentals} from './pubsub-batch';
import {queueMarketCapRefresh} from './market-cap-queue';
import {publishJobMessage} from '../job-pubsub';
import type {MaintenanceLog} from '../maintenance-log';
import {syncCompanyInstrument} from '../instruments/service';

export type SeedRun={version:1;type:'fundamentals.seed.requested'|'fundamentals.seed-only.requested'|'instruments.sync.requested';batchId:string;requestedAt:string};
export type SeedMessage=SeedRun|CompanyWorkRequest;
const parentRef=(db:Firestore,id:string)=>db.collection(FUNDAMENTALS_COLLECTION).doc(`_seed_${id}`);
export function parseSeedMessage(value:unknown):SeedMessage{
  if((value as {type?:string})?.type==='company.work.requested')return parseCompanyWorkRequest(value,(value as CompanyWorkRequest).kind==='instrument-sync'?'instrument-sync':'us-fundamentals-seed');
  const v=value as SeedRun;
  if(!v||v.version!==1||!['fundamentals.seed.requested','fundamentals.seed-only.requested','instruments.sync.requested'].includes(v.type)||typeof v.batchId!=='string'||!/^[\w-]{1,100}$/.test(v.batchId)||typeof v.requestedAt!=='string'||!Number.isFinite(Date.parse(v.requestedAt)))throw Error('Invalid fundamentals seed request');
  return {version:1,type:v.type,batchId:v.batchId,requestedAt:v.requestedAt};
}
export async function queueFundamentalsSeeding(db:Firestore,execution:string,companyIds:string[],topic:string,seedOnly:boolean|'instruments'=false,
  publish:(message:SeedMessage)=>Promise<unknown>=message=>publishJobMessage(topic,message)){
  const ids=[...new Set(companyIds)].sort();
  if(!ids.length||ids.some(id=>seedOnly==='instruments'?!/^(US:|ORG:|XSHG:|XSHE:)[A-Z0-9.-]+$/.test(id):usFundamentalsTicker(id)===null)||Buffer.byteLength(JSON.stringify(ids))>500_000)throw Error('Invalid fundamentals seed scope');
  const ref=parentRef(db,digest({execution,kind:'seed',seedOnly}));
  const request=await db.runTransaction(async tx=>{
    const existing=(await tx.get(ref)).data();
    if(existing){if(digest(existing.companyIds)!==digest(ids))throw Error('Seed scope changed');return parseSeedMessage(existing.request) as SeedRun;}
    const request:SeedRun={version:1,type:seedOnly==='instruments'?'instruments.sync.requested':seedOnly?'fundamentals.seed-only.requested':'fundamentals.seed.requested',batchId:ref.id.slice(6),requestedAt:new Date().toISOString()};
    tx.create(ref,{request,companyIds:ids,phase:'companies',dispatchCursor:0,completedCompanies:0});return request;
  });
  await publish(request);return {queued:true,batchId:request.batchId,requested:ids.length};
}
export async function processSeedMessage(value:SeedMessage,db:Firestore,log:MaintenanceLog,
  publish:(message:SeedMessage)=>Promise<unknown>=message=>publishJobMessage(process.env.FUNDAMENTALS_REQUEST_TOPIC||'sec-fundamentals-requests',message),
  dependencies:{seed?:typeof requestCompanyFundamentals;audit?:typeof auditMapFundamentals;dispatch?:typeof publishPendingFundamentals;caps?:typeof queueMarketCapRefresh;instrument?:typeof syncCompanyInstrument}={}){
  const message=parseSeedMessage(value),instrumentRun=message.type==='instruments.sync.requested'||('kind'in message&&message.kind==='instrument-sync'),state=db.collection(FUNDAMENTALS_COLLECTION).doc(instrumentRun?'_instrument_pipeline':'_seed_pipeline');
  if(message.type==='company.work.requested')return processCompanyWork<SeedRun>(message,{
    db,parent:parentRef(db,message.parentBatchId),state,collection:FUNDAMENTALS_COLLECTION,owner:log.runId,publish,
    work:async()=>{
      if(instrumentRun){const company=await db.collection('companies').doc(message.companyId).get();if(company.exists&&company.get('isDeleted')!==true)await (dependencies.instrument??syncCompanyInstrument)(db,message.companyId,company.data()!);}
      else await (dependencies.seed??requestCompanyFundamentals)(usFundamentalsTicker(message.companyId)!,db);
      return null;
    },
  });
  const ref=parentRef(db,message.batchId);
  return processCompanyRun(message,{
    db,ref,state,collection:FUNDAMENTALS_COLLECTION,kind:instrumentRun?'instrument-sync':'us-fundamentals-seed',owner:log.runId,publish,
    plan:async()=>{throw Error('Missing seed manifest');},prepare:async()=>({}),
    finalize:async()=>{
      if(instrumentRun)return null;
      const ids=(await ref.get()).get('companyIds') as string[],tickers=ids.map(id=>usFundamentalsTicker(id)!);
      const coverage=await (dependencies.audit??auditMapFundamentals)(db,tickers);
      if(message.type==='fundamentals.seed.requested'){
        const topic=process.env.FUNDAMENTALS_REQUEST_TOPIC||'sec-fundamentals-requests';
        const result=await (dependencies.dispatch??publishPendingFundamentals)(db,message.batchId,request=>publishFundamentalsMessage(topic,request),log);
        const marketCaps=await (dependencies.caps??queueMarketCapRefresh)(db,message.batchId,tickers,topic);
        await ref.set({result:{coverage,publication:result,marketCaps}},{merge:true});
      }else await ref.set({result:{coverage}},{merge:true});
      return null;
    },
  });
}
