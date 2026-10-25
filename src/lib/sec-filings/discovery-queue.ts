import {createHash} from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import type {ThemedCompany} from '../company-themes/model';
import {supportedCompanyUniverse} from '../company-support/model';
import {readSecCollectorCursor,secCollectorFreshness,secCollectorMetadata} from './store';

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
}){
  const now=options.now??Date.now,requestedAt=new Date(now()).toISOString();
  const sorted=[...new Set(ids)].sort();
  if(sorted.some(id=>!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(id)))throw new Error('Invalid SEC discovery scope');
  const start=options.after?sorted.findIndex(id=>id>options.after!):0,index=start<0?0:start;
  const ordered=[...sorted.slice(index),...sorted.slice(0,index)];
  const result={requested:0,failed:0,deferred:0,afterCompanyId:options.after??null};
  // Sequential publication keeps the rotation checkpoint contiguous on failure.
  for(const companyId of ordered){
    if(now()+30000>=options.deadline||result.requested>=(options.maxCompanies??500)){result.deferred++;continue;}
    const batchId='secd_'+createHash('sha256').update(JSON.stringify([options.execution,companyId])).digest('hex');
    try{await publish(parseSecDiscoveryTask({version:1,type:'sec.company.discovery.requested',batchId,companyId,requestedAt}));result.requested++;result.afterCompanyId=companyId;}
    catch{result.failed++;break;}
  }
  return result;
}
export async function processSecDiscoveryTask(input:unknown,db:Firestore,options:{enabled:boolean;run:(ticker:string)=>Promise<Record<string,unknown>>}){
  const task=parseSecDiscoveryTask(input);
  if(!options.enabled)throw new Error('SEC discovery worker disabled; retain task');
  const doc=await db.collection('companies').doc(task.companyId).get();
  const graph=supportedCompanyUniverse(doc.exists?[{...doc.data(),id:doc.id} as ThemedCompany]:[]);
  if(!graph.nodes.some(node=>node.id===task.companyId))return {status:'ineligible',companyId:task.companyId};
  return options.run(task.companyId.slice(3));
}
/** Public freshness reflects completed company scans, never queue acceptance. */
export async function updateSecDiscoveryFreshness(db:Firestore,ids:readonly string[],earnings:boolean,now=Date.now()){
  let oldest=now,incomplete=0;
  for(const id of ids){
    const [financial,disclosure,earning]=await Promise.all([readSecCollectorCursor(db,id.slice(3)),
      db.collection('collectors').doc(`sec-${id}`).get(),earnings?db.collection('earnings_collectors').doc(`us_${id.replaceAll('.','_')}`).get():undefined]);
    const d=disclosure.data(),e=earning?.data();
    const times=[financial?.lastCompleteAt,d?.lastSuccessAt,...(earnings?[e?.lastCompleteAt]:[])].map(value=>Date.parse(String(value)));
    if(financial?.scan||d?.status!=='complete'||(earnings&&e?.status!=='complete')||times.some(t=>!Number.isFinite(t)||t>now)){incomplete++;continue;}
    oldest=Math.min(oldest,...times);
  }
  if(!ids.length)incomplete++;
  const result={companies:ids.length,failed:0,partial:incomplete,remaining:incomplete,outboxIncomplete:false};
  await secCollectorFreshness(db).set({lastRunAt:new Date(oldest).toISOString(),result},{merge:true});
  return result;
}
export async function saveSecDiscoveryRotation(db:Firestore,after:string|null){
  if(after)await secCollectorMetadata(db).set({afterCompanyId:after.slice(3)},{merge:true});
}
