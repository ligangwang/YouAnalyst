import {FieldValue,type Firestore} from "firebase-admin/firestore";
import {cloudRunTaskAttempt} from "./maintenance-lease";
import {releaseMaintenanceLease} from './maintenance-lease';
export const SEC_COLLECTOR_STATE_COLLECTION = "sec_collector_state";
const ID="_sec_filings_collector";
export function secDiscoveryCompanyState(db:Firestore,ticker:string){
  if(!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker))throw new Error('Invalid SEC discovery ticker');
  return db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(`_discovery_${ticker}`);
}
/** Direct scans and queued deliveries fence the same company. During rollout a
 * queued delivery also defers to the old global collector's active lease. */
export async function acquireSecDiscoveryCompanyLease(db:Firestore,ticker:string,owner:string,now:number,globalOwned=false,task=cloudRunTaskAttempt()){
  const ref=secDiscoveryCompanyState(db,ticker),global=db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID);
  return db.runTransaction(async tx=>{
    const company=await tx.get(ref),state=await tx.get(global);
    if(!globalOwned && Number(state.get('leaseExpiresAtMs'))>now)return false;
    const data=company.data(),recovering=task&&data?.leaseTask?.execution===task.execution&&data.leaseTask.index===task.index&&task.attempt>data.leaseTask.attempt;
    if(Number(data?.leaseExpiresAtMs)>now&&!recovering)return false;
    tx.set(ref,{leaseOwner:owner,leaseExpiresAtMs:now+30*60000,leaseTask:task??FieldValue.delete()},{merge:true});
    return true;
  });
}
/** Commit the final single-company status with the owner-checked lease release. */
export async function releaseSecDiscoveryCompanyLease(db:Firestore,ticker:string,owner:string,completion?:{afterCompanyId:string;lastRunAt:string;result:unknown;discoveryStatus?:'complete'|'partial';discoveryNextPollAtMs?:number;discoveryCompleteAt?:string}){
  const ref=secDiscoveryCompanyState(db,ticker);
  if(!completion)return releaseMaintenanceLease(ref,owner);
  await db.runTransaction(async tx=>{
    if((await tx.get(ref)).get('leaseOwner')!==owner)return;
    tx.set(ref,{...completion,leaseOwner:FieldValue.delete(),leaseExpiresAtMs:FieldValue.delete(),leaseTask:FieldValue.delete()},{merge:true});
  });
}
export async function acquireSecCollectorLease(db:Firestore,owner:string,now:number,task:ReturnType<typeof cloudRunTaskAttempt>){
  const ref=db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID);
  return db.runTransaction(async tx=>{
    const data=(await tx.get(ref)).data();
    const recovering=task&&data?.leaseTask?.execution===task.execution&&data.leaseTask.index===task.index&&task.attempt>data.leaseTask.attempt;
    if(Number(data?.leaseExpiresAtMs)>now&&!recovering)return false;
    tx.set(ref,{leaseOwner:owner,leaseExpiresAtMs:now+30*60_000,leaseTask:task??FieldValue.delete()},{merge:true});
    return true;
  });
}
export async function releaseSecCollectorLease(db:Firestore,owner:string){
  return releaseMaintenanceLease(db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID),owner);
}
