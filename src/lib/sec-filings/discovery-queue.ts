import {secDiscoveryCompanyState} from '../sec-collector-state';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Firestore} from 'firebase-admin/firestore';
import {readSecCollectionCompany} from '../company-support/collection-reader';
import {supportedCompanyUniverse} from '../company-support/model';
import {secCollectorMetadata} from './store';

export const SEC_DISCOVERY_TOPIC='sec-company-discovery-requests';
export const SEC_DISCOVERY_SUBSCRIPTION='sec-company-discovery-worker';
export type SecDiscoveryTask={version:1;type:'sec.company.discovery.requested';batchId:string;companyId:string;requestedAt:string};
export function parseSecDiscoveryTask(input:unknown):SecDiscoveryTask{
  const task=input as Partial<SecDiscoveryTask>|null;
  if(!task||task.version!==1||task.type!=='sec.company.discovery.requested'
    ||typeof task.companyId!=='string'||!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(task.companyId)
    ||typeof task.batchId!=='string'||!/^secd_[a-f0-9]{64}$/.test(task.batchId)
    ||typeof task.requestedAt!=='string'||!Number.isFinite(Date.parse(task.requestedAt)))throw new Error('Invalid SEC company discovery task');
  return {version:1,type:task.type,batchId:task.batchId,companyId:task.companyId,requestedAt:task.requestedAt};
}
/** The hourly job reads checkpoints and publishes; it never contacts SEC. */
export async function publishSecDiscoveryTasks(ids:readonly string[],publish:(task:SecDiscoveryTask)=>Promise<unknown>,options:{
  execution:string;deadline:number;now?:()=>number;maxCompanies?:number;after?:string;
  intervalMs?:number;sleep?:(ms:number)=>Promise<void>;
}){
  const now=options.now??Date.now,requestedAt=new Date(now()).toISOString();
  const intervalMs=options.intervalMs??1000,sleep=options.sleep??delay;
  if(!Number.isSafeInteger(intervalMs)||intervalMs<0||intervalMs>60000)throw new Error('Invalid SEC discovery dispatch interval');
  const sorted=[...new Set(ids)].sort();
  if(sorted.some(id=>!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(id)))throw new Error('Invalid SEC discovery scope');
  const start=options.after?sorted.findIndex(id=>id>options.after!):0,index=start<0?0:start;
  const ordered=[...sorted.slice(index),...sorted.slice(0,index)];
  const result={requested:0,failed:0,deferred:0,afterCompanyId:options.after??null};
  // Sequential publication keeps the rotation checkpoint contiguous on failure.
  for(const companyId of ordered){
    // Spread scheduled bursts across the hour without changing the subscriber's
    // SEC concurrency limit. Keep enough time to save the rotation checkpoint.
    if(now()+30000>=options.deadline||result.requested>=(options.maxCompanies??500)){result.deferred++;continue;}
    if(result.requested>0&&intervalMs){
      if(now()+30000+intervalMs>=options.deadline){result.deferred++;continue;}
      await sleep(intervalMs);
      if(now()+30000>=options.deadline){result.deferred++;continue;}
    }
    const batchId='secd_'+createHash('sha256').update(JSON.stringify([options.execution,companyId])).digest('hex');
    try{await publish(parseSecDiscoveryTask({version:1,type:'sec.company.discovery.requested',batchId,companyId,requestedAt}));result.requested++;result.afterCompanyId=companyId;}
    catch{result.failed++;break;}
  }
  return result;
}
export async function processSecDiscoveryTask(input:unknown,db:Firestore,options:{enabled:boolean;run:(ticker:string)=>Promise<Record<string,unknown>>}){
  const task=parseSecDiscoveryTask(input);
  if(!options.enabled)throw new Error('SEC discovery worker disabled; retain task');
  const doc=await readSecCollectionCompany(db,task.companyId);
  const graph=supportedCompanyUniverse(doc?[doc]:[]);
  if(!graph.nodes.some(node=>node.id===task.companyId))return {status:'ineligible',companyId:task.companyId};
  try{return await options.run(task.companyId.slice(3));}
  catch(error){
    // Failures before the collector acquires its lease still need a retry time.
    // Do not overwrite a current lease or the completion already saved by it.
    const ref=secDiscoveryCompanyState(db,task.companyId.slice(3)),now=Date.now();
    await db.runTransaction(async tx=>{
      const state=(await tx.get(ref)).data();
      if(Number(state?.leaseExpiresAtMs)>now||Number(state?.discoveryNextPollAtMs)>now)return;
      tx.set(ref,{discoveryStatus:'partial',discoveryNextPollAtMs:now+15*60000},{merge:true});
    });
    throw error;
  }
}
export async function saveSecDiscoveryRotation(db:Firestore,after:string|null){
  if(after)await secCollectorMetadata(db).set({afterCompanyId:after.slice(3)},{merge:true});
}
