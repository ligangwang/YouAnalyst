import {FieldValue,type Firestore} from "firebase-admin/firestore";
import {cloudRunTaskAttempt} from "./maintenance-lease";
export const SEC_COLLECTOR_STATE_COLLECTION = "sec_collector_state";
const ID="_sec_filings_collector";
export async function secCollectorBridge(db:Firestore){
  return (await db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID).get()).get("bridgeRetired")!==true;
}
export async function acquireSecCollectorLease(db:Firestore,owner:string,now:number,task:ReturnType<typeof cloudRunTaskAttempt>){
  const ref=db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID),legacy=db.collection("company_fundamentals").doc(ID);
  return db.runTransaction(async tx=>{
    const state=await tx.get(ref),bridge=state.get("bridgeRetired")!==true;
    const old=bridge?await tx.get(legacy):undefined;
    for(const data of [state.data(),old?.data()]){
      const recovering=task&&data?.leaseTask?.execution===task.execution&&data.leaseTask.index===task.index&&task.attempt>data.leaseTask.attempt;
      if(Number(data?.leaseExpiresAtMs)>now&&!recovering)return false;
    }
    const lease={leaseOwner:owner,leaseExpiresAtMs:now+30*60_000,leaseTask:task??FieldValue.delete()};
    tx.set(ref,{...(bridge?old?.data():{}),...lease},{merge:true});
    if(bridge)tx.set(legacy,lease,{merge:true});
    return true;
  });
}
export async function releaseSecCollectorLease(db:Firestore,owner:string){
  const ref=db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID),legacy=db.collection("company_fundamentals").doc(ID);
  await db.runTransaction(async tx=>{
    const state=await tx.get(ref),bridge=state.get("bridgeRetired")!==true;
    const old=bridge?await tx.get(legacy):undefined;
    const clear={leaseOwner:FieldValue.delete(),leaseExpiresAtMs:FieldValue.delete(),leaseTask:FieldValue.delete()};
    if(state.get("leaseOwner")===owner)tx.set(ref,clear,{merge:true});
    if(old?.get("leaseOwner")===owner)tx.set(legacy,clear,{merge:true});
  });
}
