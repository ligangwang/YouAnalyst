import type {Firestore} from 'firebase-admin/firestore';
import {companyWorkRef,companyWorkRequest,type CompanyRun,type CompanyWorkRequest} from '../company-work-queue';
import {digest} from '../fundamentals/pubsub';
import type {EodCompanyRunRequest} from './eod-company-queue';

// An incomplete date must remain visibly failed, not hold every later date forever.
// Keep the receipts for an explicit repair; never manufacture prices or finalize
// portfolios from a partial company set. Existing status/error fields suffice.
export const EOD_COMPANY_RECOVERY_MS=60*60_000;
export async function retireExpiredEodRun(db:Firestore,now=Date.now(),retryUnstarted?:(task:CompanyWorkRequest)=>Promise<unknown>):Promise<string|null>{
  const state=db.collection('eod_runs').doc('_company_pipeline');
  const outcome=await db.runTransaction(async tx=>{
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
    const unstarted:CompanyWorkRequest[]=[];
    for(let i=0;i<run.companyIds.length;i+=100){
      const tasks=run.companyIds.slice(i,i+100).map(id=>companyWorkRequest('eod',request,id));
      const receipts=await tx.getAll(...tasks.map(task=>companyWorkRef(db,'eod_runs',task.batchId)));
      for(let j=0;j<receipts.length;j++){
        const receipt=receipts[j];
        // Reading leases in this transaction fences both in-flight work and a
        // concurrent new child attempt. Never retire a worker underneath it.
        if(Number(receipt.get('leaseExpiresAtMs'))>now)return null;
        if(!receipt.get('request')||digest(receipt.get('request'))!==digest(tasks[j]))throw Error('Invalid EOD recovery receipt');
        if(receipt.get('completed')!==true){
          incomplete++;
          if(!receipt.get('startedAt')&&unstarted.length<25)unstarted.push(tasks[j]);
        }
      }
    }
    if(!incomplete)return null; // A lost finalizer wakeup is still a successful run.
    // Queue/admission delays are not evidence of a company data failure. Give
    // every receipt a real attempt before considering terminal retirement.
    if(unstarted.length)return {unstarted};
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
  if(outcome&&typeof outcome!=='string'){
    for(const task of outcome.unstarted)await retryUnstarted?.(task);
    return null;
  }
  return outcome;
}

/** Explicit operator repair of a terminal run. Reuse IDs, prepared bars and
 * successful receipts; dispatch skips completed children and rechecks all receipts
 * before portfolio finalization. Never reopen underneath another active run. */
export async function reopenFailedEodRun(db:Firestore,batchId:string,now=Date.now()){
  if(!/^[\w-]{1,100}$/.test(batchId))throw Error('Invalid EOD batch');
  const state=db.collection('eod_runs').doc('_company_pipeline'),ref=db.collection('eod_runs').doc(`_request_${batchId}`);
  return db.runTransaction(async tx=>{
    const pipeline=await tx.get(state),saved=await tx.get(ref),run=saved.data() as CompanyRun<EodCompanyRunRequest>|undefined;
    if(pipeline.get('activeRequest')||Number(pipeline.get('leaseExpiresAtMs'))>now)throw Error('EOD pipeline is active');
    if(!run?.completed||saved.get('status')!=='FAILED'||!run.companyIds||run.request.batchId!==batchId||run.request.type!=='eod.company-run.requested')throw Error('EOD run is not a repairable failed company run');
    if(Number(saved.get('leaseExpiresAtMs'))>now)throw Error('EOD parent lease is active');
    let completedCompanies=0;
    for(let i=0;i<run.companyIds.length;i+=100){
      const tasks=run.companyIds.slice(i,i+100).map(id=>companyWorkRequest('eod',run.request,id));
      const receipts=await tx.getAll(...tasks.map(task=>companyWorkRef(db,'eod_runs',task.batchId)));
      receipts.forEach((receipt,index)=>{
        if(Number(receipt.get('leaseExpiresAtMs'))>now)throw Error('EOD child lease is active');
        if(!receipt.get('request')||digest(receipt.get('request'))!==digest(tasks[index]))throw Error('Invalid EOD repair receipt');
        if(receipt.get('completed')===true)completedCompanies++;
      });
    }
    const dispatch=db.collection('eod_runs').doc(`_dispatch_${digest(run.request.input)}`),active=(await tx.get(dispatch)).get('activeRequest');
    if(active&&active.batchId!==batchId)throw Error('Another EOD request owns this scope');
    tx.set(ref,{completed:false,phase:'companies',dispatchCursor:0,completedCompanies,finalizeCursor:null,startedAt:new Date(now).toISOString(),completedAt:null,failedAt:null,status:'STARTED',error:null},{merge:true});
    tx.set(state,{activeRequest:run.request},{merge:true});
    tx.set(dispatch,{activeRequest:run.request},{merge:true});
    return run.request;
  });
}
