import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {isSupportedCompany} from '../company-support/model';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,createOnboardingRequest,onboardingIdentity,parseOnboardingRequest,OnboardingBlocked,type OnboardingRequest,type OnboardingStep} from './model';

const LEASE_MS=20*60_000;
const readinessIdentity=(company:Record<string,unknown>)=>Object.fromEntries(['status','isDeleted','name','description','cik','themeMemberships','inGraph','symbol','exchange','micCode','supersededByCompanyId'].map(key=>[key,company[key]]));
type Context={request:OnboardingRequest;company:Record<string,unknown>;guard:()=>Promise<void>};
export type OnboardingHandlers=Record<OnboardingStep,(context:Context)=>Promise<void>>;
const summary=(status:OnboardingRequest['status'],at:number,requestedAt:string,previous:Record<string,unknown>={},reason:string|null=null)=>({
  status,version:1,requestedAt:previous.requestedAt??Timestamp.fromDate(new Date(requestedAt)),
  startedAt:previous.startedAt??(status==='PROCESSING'?Timestamp.fromMillis(at):null),
  supportedAt:status==='SUPPORTED'?Timestamp.fromMillis(at):null,updatedAt:Timestamp.fromMillis(at),blockedReason:reason,
});

/** Public requests only record intent. No provider calls, work publication or enrollment. */
export async function requestCompanyOnboarding(db:Firestore,companyId:string,now=Date.now()){
  if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))throw new OnboardingBlocked('Unsupported company identity');
  const companyRef=db.collection('companies').doc(companyId),ref=db.collection(ONBOARDING_COLLECTION).doc(companyId);
  return db.runTransaction(async tx=>{
    const [doc,saved]=await tx.getAll(companyRef,ref),company=doc.data();
    if(!company)throw new OnboardingBlocked('Company does not exist');
    if(isSupportedCompany(company))return {companyId,status:'SUPPORTED' as const};
    onboardingIdentity(companyId,company);
    if(saved.exists){const current=parseOnboardingRequest(saved.data());if(current.companyId!==companyId)throw Error('Onboarding identity mismatch');return {companyId,status:current.status};}
    const request=createOnboardingRequest(companyId,company,new Date(now));
    tx.create(ref,request);
    tx.update(companyRef,{onboarding:summary('QUEUED',now,request.requestedAt),updatedAt:Timestamp.fromMillis(now)});
    return {companyId,status:'QUEUED' as const};
  });
}

/** One checkpoint per invocation; bounded jobs can resume without repeating completed work. */
export async function processCompanyOnboarding(db:Firestore,companyId:string,handlers:OnboardingHandlers,clock=Date.now){
  if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))throw Error('Invalid company identity');
  const ref=db.collection(ONBOARDING_COLLECTION).doc(companyId),companyRef=db.collection('companies').doc(companyId),owner=randomUUID();
  const claimed=await db.runTransaction(async tx=>{
    const [saved,doc]=await tx.getAll(ref,companyRef);
    if(!saved.exists)return null;
    const request=parseOnboardingRequest(saved.data()),company=doc.data();
    if(request.companyId!==companyId)throw Error('Onboarding identity mismatch');
    if(['SUPPORTED','BLOCKED'].includes(request.status)||request.nextAttemptAt>clock()||request.leaseExpiresAt>clock())return null;
    if(!company||isSupportedCompany(company))return null;
    const current={...request,steps:{...request.steps},status:'PROCESSING' as const,leaseOwner:owner,leaseExpiresAt:clock()+LEASE_MS,updatedAt:new Date(clock()).toISOString()};
    if(request.steps.events==='COMPLETE'){
      let through=current.targetThrough;
      try{through=createOnboardingRequest(companyId,company,new Date(clock())).targetThrough;}catch(error){if(!(error instanceof OnboardingBlocked))throw error;}
      if(through>current.targetThrough){current.targetThrough=through;for(const key of ['corporateActions','prices','metrics','events','verify'] as const)delete current.steps[key];}
    }
    tx.set(ref,current);
    tx.update(companyRef,{onboarding:summary('PROCESSING',clock(),request.requestedAt,company.onboarding),updatedAt:Timestamp.fromMillis(clock())});
    return {request:current,company};
  });
  if(!claimed)return {status:'SKIPPED' as const};
  const step=ONBOARDING_STEPS.find(step=>claimed.request.steps[step]!=='COMPLETE')??'verify';
  const guard=async()=>{
    const [saved,doc]=await db.getAll(ref,companyRef),request=parseOnboardingRequest(saved.data());
    if(request.leaseOwner!==owner||request.leaseExpiresAt<=clock()||request.status!=='PROCESSING')throw Error('Onboarding lease lost');
    onboardingIdentity(companyId,doc.data()??{});
  };
  try{
    await guard();
    await handlers[step]({...claimed,guard});
    await db.runTransaction(async tx=>{
      const [saved,doc]=await tx.getAll(ref,companyRef),current=parseOnboardingRequest(saved.data()),company=doc.data()??{};
      if(current.leaseOwner!==owner||current.leaseExpiresAt<=clock()||current.status!=='PROCESSING')throw Error('Onboarding lease lost');
      onboardingIdentity(companyId,company);
      const steps={...current.steps,[step]:'COMPLETE' as const},done=ONBOARDING_STEPS.every(key=>steps[key]==='COMPLETE');
      if(done&&step!=='verify')throw Error('Readiness verification must run last');
      if(done&&!isDeepStrictEqual(readinessIdentity(company),readinessIdentity(claimed.company)))throw Error('Company readiness changed during verification');
      if(done&&createOnboardingRequest(companyId,company,new Date(clock())).targetThrough>current.targetThrough)throw Error('Onboarding needs a latest-session catchup');
      const status=done?'SUPPORTED':'QUEUED';
      tx.set(ref,{...current,steps,status,attemptCount:0,nextAttemptAt:0,leaseOwner:null,leaseExpiresAt:0,lastError:null,updatedAt:new Date(clock()).toISOString()});
      // Keep the public summary processing across checkpoints; QUEUED is initial intent only.
      tx.update(companyRef,{onboarding:summary(done?'SUPPORTED':'PROCESSING',clock(),current.requestedAt,company.onboarding),updatedAt:Timestamp.fromMillis(clock())});
    });
    return {status:step==='verify'?'SUPPORTED' as const:'CHECKPOINTED' as const,step};
  }catch(error){
    // Never store provider errors/URLs/tokens on a public company record.
    const reason=error instanceof OnboardingBlocked?error.message:`${step}: retryable onboarding failure`;
    await db.runTransaction(async tx=>{
      const [saved,doc]=await tx.getAll(ref,companyRef),current=parseOnboardingRequest(saved.data());
      if(current.leaseOwner!==owner||current.leaseExpiresAt<=clock())return;
      const attemptCount=current.attemptCount+1,blocked=error instanceof OnboardingBlocked||attemptCount>=8;
      tx.set(ref,{...current,status:blocked?'BLOCKED':'QUEUED',attemptCount,nextAttemptAt:blocked?0:clock()+Math.min(6*3600_000,60_000*2**(attemptCount-1)),leaseOwner:null,leaseExpiresAt:0,lastError:reason,updatedAt:new Date(clock()).toISOString()});
      if(doc.exists)tx.update(companyRef,{onboarding:summary(blocked?'BLOCKED':'PROCESSING',clock(),current.requestedAt,doc.get('onboarding'),blocked?reason:null),updatedAt:Timestamp.fromMillis(clock())});
    });
    return {status:'INCOMPLETE' as const,step};
  }
}

/** Operator-only repair action; public duplicate requests never reset a blocked job. */
export async function resumeCompanyOnboarding(db:Firestore,companyId:string,now=Date.now()){
  if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))throw Error('Invalid company identity');
  const ref=db.collection(ONBOARDING_COLLECTION).doc(companyId),companyRef=db.collection('companies').doc(companyId);
  return db.runTransaction(async tx=>{
    const [saved,doc]=await tx.getAll(ref,companyRef);if(!saved.exists)throw Error('Onboarding request does not exist');
    const request=parseOnboardingRequest(saved.data());if(request.companyId!==companyId)throw Error('Request identity mismatch');
    if(request.status!=='BLOCKED'||request.leaseExpiresAt>now)throw Error('Only an idle blocked request may be resumed');
    onboardingIdentity(companyId,doc.data()??{});
    tx.set(ref,{...request,status:'QUEUED',attemptCount:0,nextAttemptAt:0,lastError:null,leaseOwner:null,leaseExpiresAt:0,updatedAt:new Date(now).toISOString()});
    tx.update(companyRef,{onboarding:summary('PROCESSING',now,request.requestedAt,doc.get('onboarding')),updatedAt:Timestamp.fromMillis(now)});
    return {companyId,status:'QUEUED'};
  });
}
