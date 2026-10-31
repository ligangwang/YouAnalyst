import type {Firestore} from 'firebase-admin/firestore';
import {companyWorkRef,companyWorkRequest,type CompanyRun} from '../company-work-queue';
import {digest} from '../fundamentals/pubsub';
import type {EodCompanyRunRequest} from './eod-company-queue';

// An incomplete date must remain visibly failed, not hold every later date forever.
// Keep the receipts for an explicit repair; never manufacture prices or finalize
// portfolios from a partial company set. Existing status/error fields suffice.
export const EOD_COMPANY_RECOVERY_MS=60*60_000;
export async function retireExpiredEodRun(db:Firestore,now=Date.now()):Promise<string|null>{
  const state=db.collection('eod_runs').doc('_company_pipeline');
  return db.runTransaction(async tx=>{
    const pipeline=await tx.get(state),request=pipeline.get('activeRequest') as EodCompanyRunRequest|undefined;
    if(!request||Number(pipeline.get('leaseExpiresAtMs'))>now)return null;
    const ref=db.collection('eod_runs').doc(`_request_${request.batchId}`);
    const saved=await tx.get(ref),run=saved.data() as CompanyRun<EodCompanyRunRequest>|undefined;
    if(!run||digest(run.request)!==digest(request)||run.completed)return null;
    // Adopt pre-deployment runs without counting days spent queued against their
    // retry budget. Never expire a catch-up run merely because its request is old.
    if(run.companyIds&&!saved.get('startedAt')){
      tx.set(ref,{startedAt:new Date(now).toISOString()},{merge:true});return null;
    }
    const startedAt=Date.parse(saved.get('startedAt'));
    if(run.phase!=='waiting'
      ||!run.companyIds||run.dispatchCursor!==run.companyIds.length
      ||!Number.isFinite(startedAt)||now-startedAt<EOD_COMPANY_RECOVERY_MS
      ||Number(saved.get('leaseExpiresAtMs'))>now)return null;
    let incomplete=0;
    for(let i=0;i<run.companyIds.length;i+=100){
      const tasks=run.companyIds.slice(i,i+100).map(id=>companyWorkRequest('eod',request,id));
      const receipts=await tx.getAll(...tasks.map(task=>companyWorkRef(db,'eod_runs',task.batchId)));
      for(let j=0;j<receipts.length;j++){
        const receipt=receipts[j];
        // Reading leases in this transaction fences both in-flight work and a
        // concurrent new child attempt. Never retire a worker underneath it.
        if(Number(receipt.get('leaseExpiresAtMs'))>now)return null;
        if(!receipt.get('request')||digest(receipt.get('request'))!==digest(tasks[j]))throw Error('Invalid EOD recovery receipt');
        if(receipt.get('completed')!==true)incomplete++;
      }
    }
    if(!incomplete)return null; // A lost finalizer wakeup is still a successful run.
    const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(request.input)}`);
    const active=(await tx.get(dispatch)).get('activeRequest');
    const error=`EOD recovery window expired with ${incomplete}/${run.companyIds.length} incomplete companies; receipts retained for repair; portfolio finalization withheld`;
    tx.set(ref,{completed:true,phase:'completed',status:'FAILED',error,failedAt:new Date(now).toISOString()},{merge:true});
    tx.set(db.collection('eod_runs').doc(`${request.input.market}_${request.input.runDate}`),
      {status:'FAILED',error,failedAt:new Date(now).toISOString()},{merge:true});
    tx.set(state,{activeRequest:null},{merge:true});
    if(active?.batchId===request.batchId)tx.set(dispatch,{activeRequest:null},{merge:true});
    return request.batchId;
  });
}
