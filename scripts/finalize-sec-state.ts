import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {FieldPath,FieldValue} from 'firebase-admin/firestore';
import {getFirestore} from '../src/lib/firebase/firestore';
import {acquireSecCollectorLease,releaseSecCollectorLease,SEC_COLLECTOR_STATE_COLLECTION} from '../src/lib/sec-collector-state';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// Run only after verifying every SEC caller runs bridge-aware code and every
// execution of the old image has completed. No schedules or services are paused.
async function main(){
 if(process.argv.slice(2).join(' ')!=='--apply --legacy-workers-drained')throw Error('Requires --apply --legacy-workers-drained after verifying deployed revisions and executions');
 if(!process.env.GCP_PROJECT_ID)throw Error('GCP_PROJECT_ID required');
 initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
 const db=getFirestore(),owner=`migration-${randomUUID()}`,meta=db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc('_sec_filings_collector');
 if((await meta.get()).get('bridgeRetired')===true){console.log('SEC state bridge already retired');return;}
 if(!await acquireSecCollectorLease(db,owner,Date.now(),undefined))throw Error('Collector active; retry after its run completes');
 try{
  let after='',copied=0;
  for(;;){
   let query=db.collection('company_fundamentals').orderBy(FieldPath.documentId()).select('secFilingsCollector').limit(100);
   if(after)query=query.startAfter(after);
   const page=await query.get();
   for(const doc of page.docs){
    const cursor=doc.get('secFilingsCollector');
    if(cursor){await db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(doc.id).set({secFilingsCollector:cursor},{merge:true});copied++;await delay(100);}
   }
   console.log(JSON.stringify({copied,after:page.docs.at(-1)?.id}));
   if(page.size<100)break;
   after=page.docs.at(-1)!.id;
  }
  const gate=db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc('_sec_request_budget');
  const oldGate=db.collection('company_fundamentals').doc('_sec_request_budget');
  const oldMeta=db.collection('company_fundamentals').doc('_sec_filings_collector');
  for(let attempt=0;;attempt++){
   const done=await db.runTransaction(async tx=>{
    const [state,legacy,oldBudget,newBudget]=await Promise.all([tx.get(meta),tx.get(oldMeta),tx.get(oldGate),tx.get(gate)]);
    if(state.get('leaseOwner')!==owner||legacy.get('leaseOwner')!==owner||Number(state.get('leaseExpiresAtMs'))<=Date.now())throw Error('Migration lease lost');
    const now=oldBudget.readTime.toMillis();
    if(Number(oldBudget.get('leaseUntil'))>now||Number(newBudget.get('leaseUntil'))>now)return false;
    tx.set(gate,{...(oldBudget.data()??{}),bridgeRetired:true,retiredAt:new Date().toISOString()},{merge:true});
    const clear={leaseOwner:FieldValue.delete(),leaseExpiresAtMs:FieldValue.delete(),leaseTask:FieldValue.delete()};
    tx.set(meta,{...clear,bridgeRetired:true,retiredAt:new Date().toISOString()},{merge:true});
    tx.set(oldMeta,clear,{merge:true});
    return true;
   });
   if(done)break;
   if(attempt>=60)throw Error('SEC gate remains active; safe to retry later');
   await delay(1000);
  }
  console.log(JSON.stringify({bridgeRetired:true,copied}));
 }finally{await releaseSecCollectorLease(db,owner);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
