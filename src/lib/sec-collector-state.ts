import {FieldValue,type Firestore} from "firebase-admin/firestore";
import {cloudRunTaskAttempt} from "./maintenance-lease";
export const SEC_COLLECTOR_STATE_COLLECTION = "sec_collector_state";
const ID="_sec_filings_collector";
// Retirement is a one-way migration. Never cache an active bridge: another
// process may retire it while this worker is running.
const retiredBridges = new WeakSet<Firestore>();
const bridgeReads = new WeakMap<Firestore, Promise<boolean>>();
export async function secCollectorBridge(db:Firestore){
  if (retiredBridges.has(db)) return false;
  const pending = bridgeReads.get(db);
  if (pending) return pending;
  const read = (async () => {
    const active = (await db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(ID).get()).get("bridgeRetired") !== true;
    if (!active) retiredBridges.add(db);
    return active;
  })();
  bridgeReads.set(db, read);
  try { return await read; }
  finally { bridgeReads.delete(db); }
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
    tx.set(ref,{...(bridge&&!state.exists?old?.data():{}),...lease},{merge:true});
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
