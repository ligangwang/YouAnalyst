import type {Firestore} from 'firebase-admin/firestore';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,parseOnboardingRequest} from './model';
import {processInstrumentOnboarding,type OnboardingHandlers} from './queue';

/** Every successful checkpoint is durable before advancing. Failed steps never loop. */
export async function drainInstrumentOnboarding(db:Firestore,id:string,handlers:OnboardingHandlers,options:{clock?:()=>number;budgetMs?:number}={}){
  const clock=options.clock??Date.now,deadline=clock()+(options.budgetMs??4*60_000);
  const checkpoints:string[]=[];
  for(let count=0;count<ONBOARDING_STEPS.length*2;count++){
    const result=await processInstrumentOnboarding(db,id,handlers,clock);
    if(result.status==='CHECKPOINTED'){
      checkpoints.push(result.step);
      if(clock()<deadline)continue;
      return {status:'CONTINUE' as const,checkpoints};
    }
    if(result.status==='SUPPORTED'||result.status==='INCOMPLETE')return {...result,checkpoints};
    const saved=await db.collection(ONBOARDING_COLLECTION).doc(id).get();
    if(!saved.exists)return {status:'IGNORED' as const,checkpoints};
    const row=parseOnboardingRequest(saved.data());
    if(row.status==='SUPPORTED'||row.status==='BLOCKED')return {status:row.status,checkpoints};
    // An active instrument/issuer lease is transport deferral, not a failed-step retry.
    // Retain this message until the current owner checkpoints or the lease expires.
    return {status:'CONTINUE' as const,checkpoints};
  }
  return {status:'CONTINUE' as const,checkpoints};
}
