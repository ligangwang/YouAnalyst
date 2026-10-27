import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Firestore} from 'firebase-admin/firestore';
import type {KnowledgeGraph} from '../knowledge-graph/model';
import type {ThemedCompany} from '../company-themes/model';
import {supportedCompanyUniverse} from '../company-support/model';
import {mapListedCompanies} from './disclosures';
import {collectCnMapDisclosures} from './cn-disclosures';
import {collectLiveEarnings} from '../earnings/live-collector';
import {loadEarningsMap} from '../earnings/map-issuers';
import {sharedEarningsRequestGate} from '../earnings/live-transport';
import {createCnEarningsRequester,createCnEarningsSources,type CnEarningsJsonRequest} from '../earnings/live-cn';
import {newsCollectorIsFresh} from '../intelligence/collectors/projection';
import {publishEarningsIntake} from '../sec-filings/intake-routing';
import type {MaintenanceLog} from '../maintenance-log';

export const CN_DISCOVERY_TOPIC='cn-company-discovery-requests';
export const CN_DISCOVERY_SUBSCRIPTION='cn-company-discovery-worker';
export type CnDiscoveryTask={version:1;type:'cn.company.discovery.requested';batchId:string;companyId:string;mode:'announcements'|'earnings-fallback';requestedAt:string};
const validId=(id:unknown):id is string=>typeof id==='string'&&/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id);
export function parseCnDiscoveryTask(input:unknown):CnDiscoveryTask{
  const row=input as Partial<CnDiscoveryTask>|null;
  if(!row||row.version!==1||row.type!=='cn.company.discovery.requested'||!validId(row.companyId)
    ||!['announcements','earnings-fallback'].includes(String(row.mode))||typeof row.batchId!=='string'||! /^cn_[a-f0-9]{64}$/.test(row.batchId)
    ||typeof row.requestedAt!=='string'||!Number.isFinite(Date.parse(row.requestedAt)))throw new Error('Invalid A-share discovery task');
  return {version:1,type:row.type,batchId:row.batchId,companyId:row.companyId,mode:row.mode!,requestedAt:row.requestedAt};
}
type State=Record<string,unknown>|undefined;
export function cnDiscoveryState(db:Firestore,id:string,mode:CnDiscoveryTask['mode']){
  return mode==='announcements'?db.collection('collectors').doc(`exchange-${id}`).get().then(doc=>doc.data()):db.collection('earnings_collectors').doc(`cn_${id}`).get().then(doc=>doc.data());
}
export function cnAnnouncementFresh(state:State,now:number){
  return state?.status==='complete'&&state.earningsCoverageVersion===2&&newsCollectorIsFresh(state.lastSuccessAt as string,0,false,new Date(now),3600000);
}
export async function publishCnDiscoveryTasks(ids:readonly string[],mode:CnDiscoveryTask['mode'],publish:(task:CnDiscoveryTask)=>Promise<unknown>,options:{
  execution:string;deadline:number;now?:()=>number;earningsEnabled:boolean;
  readState:(id:string,mode:CnDiscoveryTask['mode'])=>Promise<State>;
  intervalMs?:number;sleep?:(ms:number)=>Promise<void>;
}){
  if(ids.some(id=>!validId(id)))throw new Error('Invalid A-share company scope');
  const now=options.now??Date.now,requestedAt=new Date(now()).toISOString();
  const intervalMs=options.intervalMs??30000,sleep=options.sleep??delay;
  if(!Number.isSafeInteger(intervalMs)||intervalMs<0||intervalMs>60000)throw new Error('Invalid A-share dispatch interval');
  // State reads can remain parallel, while all publications from this run
  // share one pace. Unpublished tasks remain eligible for the next scan.
  let tail:Promise<void>=Promise.resolve(),nextPublishAt=0;
  const dispatch=async(task:CnDiscoveryTask)=>{
    const previous=tail;let release!:()=>void;
    tail=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{
      const wait=Math.max(0,nextPublishAt-now());
      if(now()+30000+wait>=options.deadline)return false;
      if(wait)await sleep(wait);
      if(now()+30000>=options.deadline)return false;
      try{await publish(task);}finally{nextPublishAt=now()+intervalMs;}
      return true;
    }finally{release();}
  };
  const result={mode:'pubsub',requested:0,skipped:0,deferred:0,failed:0};let next=0;
  const sorted=[...new Set(ids)].sort();
  // Use a step coprime to the scope size so every issuer eventually appears
  // at the front, even if every run exhausts its deadline. No schema change is
  // needed, and retries within the same 15-minute window start together.
  const gcd=(a:number,b:number):number=>b===0?a:gcd(b,a%b);
  let step=Math.min(10,Math.max(1,sorted.length-1));
  while(gcd(step,sorted.length)>1)step--;
  const start=sorted.length?((Math.floor(now()/900000)*step)%sorted.length):0;
  const companies=[...sorted.slice(start),...sorted.slice(0,start)];
  await Promise.all(Array.from({length:Math.min(8,companies.length)},async()=>{while(next<companies.length){
    const id=companies[next++];
    if(now()+30000>=options.deadline){result.deferred++;continue;}
    try{
      const state=await options.readState(id,mode);
      if(state?.status==='complete'&&Number(state.nextPollAtMs)>now()&&(mode==='earnings-fallback'||!options.earningsEnabled||state.earningsCoverageVersion===2)){result.skipped++;continue;}
      if(mode==='earnings-fallback'&&cnAnnouncementFresh(await options.readState(id,'announcements'),now())){result.skipped++;continue;}
      const batchId='cn_'+createHash('sha256').update(JSON.stringify([options.execution,mode,id])).digest('hex');
      if(await dispatch(parseCnDiscoveryTask({version:1,type:'cn.company.discovery.requested',batchId,companyId:id,mode,requestedAt})))result.requested++;
      else result.deferred++;
    }catch{result.failed++;}
  }}));return result;
}
export async function loadCnDiscoveryCompany(db:Firestore,id:string):Promise<KnowledgeGraph>{
  if(!validId(id))throw new Error('Invalid A-share company');
  const doc=await db.collection('companies').doc(id).get();
  return supportedCompanyUniverse(doc.exists?[{...doc.data(),id:doc.id} as ThemedCompany]:[]);
}
export async function processCnDiscoveryTask(input:unknown,db:Firestore,log:MaintenanceLog,options:{enabled:boolean;earningsEnabled:boolean;now?:()=>number;
  loadCompany?:(id:string)=>Promise<KnowledgeGraph>;
  announcements?:()=>Promise<{status?:string;failed?:number;deferred?:number}>;fallback?:()=>Promise<{failed?:number;deferred?:number}>;
}){
  const task=parseCnDiscoveryTask(input),now=options.now??Date.now;
  if(!options.enabled||task.mode==='earnings-fallback'&&!options.earningsEnabled)throw new Error('A-share discovery disabled; retain task');
  const graph=await (options.loadCompany??(id=>loadCnDiscoveryCompany(db,id)))(task.companyId);
  if(!mapListedCompanies(graph).some(node=>node.id===task.companyId&&node.market==='CN_A'))return {status:'ineligible',companyId:task.companyId};
  if(task.mode==='earnings-fallback'&&!options.fallback)await loadEarningsMap(db,graph);
  const deadline=now()+7*60000;
  const gate=sharedEarningsRequestGate(db),transport=createCnEarningsRequester({beforeRequest:gate.beforeRequest,onBlocked:gate.onBlocked});
  const request:CnEarningsJsonRequest=async(url,init)=>{
    if(now()+30000>=deadline)throw new Error('A-share discovery deadline reached');
    return transport.request(url,init);
  };
  const cn=createCnEarningsSources(request);
  const publish=(event:Parameters<typeof publishEarningsIntake>[1])=>publishEarningsIntake(db,event);
  const result=task.mode==='announcements'?await (options.announcements??(()=>collectCnMapDisclosures(db,graph,request,{companyId:task.companyId,completedSince:task.requestedAt,deadline,runId:log.runId,earningsEnabled:options.earningsEnabled,now,publish})))()
    :await (options.fallback??(()=>collectLiveEarnings(db,log,{companyId:task.companyId,completedSince:task.requestedAt,deadline,now,discoveryOwnedByMap:true,publish,discoverCn:async(id,from,to,at)=>(await cn.discover({companyId:id,from,to,firstSeenAt:at,maxPages:20})).sources})))();
  if(('status' in result&&result.status==='busy')||('failed' in result&&result.failed)||('deferred' in result&&result.deferred))throw new Error('A-share discovery incomplete; retry company task');
  return {...result,status:'verified',companyId:task.companyId,mode:task.mode};
}
