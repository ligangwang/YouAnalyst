import type {Firestore} from 'firebase-admin/firestore';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,parseOnboardingRequest} from './model';
import {processInstrumentOnboarding,yieldInstrumentOnboarding,type OnboardingHandlers} from './queue';
import {onboardingLeaseOwner} from './delivery-lease';

/** Every successful checkpoint is durable before advancing. Failed steps never loop. */
export async function drainInstrumentOnboarding(db:Firestore,id:string,handlers:OnboardingHandlers,options:{clock?:()=>number;budgetMs?:number;eventId?:string;requireTheme?:boolean}={}){
  const clock=options.clock??Date.now,deadline=clock()+(options.budgetMs??4*60_000);
  const checkpoints:string[]=[];
  const owner=onboardingLeaseOwner(options.eventId);
  const yieldWork=async()=>{await yieldInstrumentOnboarding(db,id,owner,clock());return {status:'YIELDED' as const,checkpoints};};
  for(let count=0;count<ONBOARDING_STEPS.length*2;count++){
    const result=await processInstrumentOnboarding(db,id,handlers,clock,{leaseOwner:owner,retainLease:true,eventId:options.eventId,requireTheme:options.requireTheme});
    if(result.status==='CHECKPOINTED'){
      checkpoints.push(result.step);
      if(clock()<deadline)continue;
      return yieldWork();
    }
    if(result.status==='SUPPORTED'||result.status==='INCOMPLETE')return {...result,checkpoints};
    if(result.status==='IN_FLIGHT')return {status:'IN_FLIGHT' as const,checkpoints};
    // The successful claim transaction already read the terminal state. A later
    // explicit retry writes its own durable event; never cache this across deliveries.
    if('terminalStatus' in result&&result.terminalStatus)return {status:result.terminalStatus,checkpoints,statusRead:'claim_transaction' as const};
    const saved=await db.collection(ONBOARDING_COLLECTION).doc(id).get();
    if(!saved.exists)return {status:'IGNORED' as const,checkpoints};
    const row=parseOnboardingRequest(saved.data());
    if(row.status==='SUPPORTED'||row.status==='BLOCKED')return {status:row.status,checkpoints};
    // An active instrument/issuer lease is transport deferral, not a failed-step retry.
    // Retain this message until the current owner checkpoints or the lease expires.
    return {status:'CONTINUE' as const,checkpoints};
  }
  return yieldWork();
}
