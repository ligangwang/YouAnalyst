import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAdminFirestore} from '../src/lib/firebase/admin';
import {withLiveCompanyReads} from '../src/lib/local-cache/company-directory';
import {onboardingRuntime} from '../src/lib/instrument-onboarding/runtime';
import {drainInstrumentOnboarding} from '../src/lib/instrument-onboarding/worker';
import {createOnboardingSubscriber} from '../src/lib/instrument-onboarding/subscriber';
import {ONBOARDING_COLLECTION} from '../src/lib/instrument-onboarding/model';
import {requireOnboardingCapacity} from '../src/lib/instrument-onboarding/capacity-control';
import {inspectOnboardingDelivery} from '../src/lib/instrument-onboarding/queue';

const project=process.env.GCP_PROJECT_ID;
if(!project)throw Error('GCP_PROJECT_ID is required');
initializeApp({credential:applicationDefault(),projectId:project});
const db=getAdminFirestore();
createOnboardingSubscriber({project,probe:id=>withLiveCompanyReads(async()=>!(await db.collection(ONBOARDING_COLLECTION).doc(id).get()).exists),admit:(id,eventId)=>withLiveCompanyReads(async()=>{
  const state=await inspectOnboardingDelivery(db,id,eventId);
  if(state!=='ready')return state;
  try{await requireOnboardingCapacity(db);return 'ready' as const;}catch{return 'capacity' as const;}
}),process:(id,eventId)=>withLiveCompanyReads(async()=>{
  try { await requireOnboardingCapacity(db); } catch { return {status:'CONTINUE'}; }
  const {handlers}=onboardingRuntime(db);
  return drainInstrumentOnboarding(db,id,handlers,{eventId});
})}).listen(Number(process.env.PORT||8080),'0.0.0.0');
