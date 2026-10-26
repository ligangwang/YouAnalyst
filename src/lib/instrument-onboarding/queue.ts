import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Timestamp,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {isSupportedCompany} from '../company-support/model';
import {instrumentId,validInstrumentId,instrumentFromCompany,validateInstrument,type Instrument} from '../instruments/model';
import {maintenanceError} from '../maintenance-log';
import {REQUESTERS_COLLECTION,requesterId} from './requesters';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,COMPANY_STEPS,createOnboardingRequest,instrumentOnboardingIdentity,parseOnboardingRequest,validRequesterUid,OnboardingBlocked,type OnboardingRequest,type OnboardingStep} from './model';

const LEASE_MS=20*60_000;
const companyStep=(step:OnboardingStep)=>COMPANY_STEPS.includes(step as typeof COMPANY_STEPS[number]);
const companyFingerprint=(company:Record<string,unknown>)=>Object.fromEntries(['status','isDeleted','name','description','cik','themeMemberships','inGraph','supersededByCompanyId'].map(key=>[key,company[key]]));
const instrumentFingerprint=(record:Instrument)=>Object.fromEntries(['companyId','symbol','status','isDeleted','providerSymbols','instrumentType','shareClass','exchangeMic','currency','underlyingInstrumentId','underlyingSharesPerReceipt'].map(key=>[key,(record as unknown as Record<string,unknown>)[key]]));
export type OnboardingContext={request:OnboardingRequest;company:Record<string,unknown>;instrument:Instrument;guard:()=>Promise<void>};
export type OnboardingHandlers=Record<OnboardingStep,(context:OnboardingContext)=>Promise<void>>;
export const onboardingSummary=(status:OnboardingRequest['status'],at:number,requestedAt:string,previous:Record<string,unknown>={},reason:string|null=null)=>({
  status,version:1,requestedAt:previous.requestedAt??Timestamp.fromDate(new Date(requestedAt)),startedAt:previous.startedAt??(status==='PROCESSING'?Timestamp.fromMillis(at):null),
  supportedAt:status==='SUPPORTED'?(previous.supportedAt??Timestamp.fromMillis(at)):null,updatedAt:Timestamp.fromMillis(at),blockedReason:reason,
});

/** Registered requests record intent, never execute provider work. */
export async function requestInstrumentOnboarding(db:Firestore,id:string,requestedByUid:string,listingId?:string,now=Date.now()){
  if(!validInstrumentId(id))throw new OnboardingBlocked('Invalid instrument identity');
  if(!validRequesterUid(requestedByUid))throw new OnboardingBlocked('Requester UID is required');
  const instRef=db.collection('instruments').doc(id),existing=(await instRef.get()).data();
  const listing=existing?.providerSymbols?.youanalyst??listingId;
  if(typeof listing!=='string'||! /^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(listing)||instrumentId(listing)!==id)throw new OnboardingBlocked('Provider listing identity is unavailable');
  const sourceRef=db.collection('companies').doc(listing),source=(await sourceRef.get()).data();
  const companyId=existing?.companyId??source?.supersededByCompanyId??listing;
  if(typeof companyId!=='string'||!companyId||companyId.includes('/'))throw new OnboardingBlocked('Invalid company identity');
  const companyRef=db.collection('companies').doc(companyId),ref=db.collection(ONBOARDING_COLLECTION).doc(id);
  const requesterRef=ref.collection(REQUESTERS_COLLECTION).doc(requesterId(requestedByUid));
  return db.runTransaction(async tx=>{
    const [inst,sourceDoc,owner,saved,requester]=await tx.getAll(instRef,sourceRef,companyRef,ref,requesterRef),company=owner.data(),source=sourceDoc.data();
    if(!company||!source||source.isDeleted||source.listingStatus==='PRIVATE')throw new OnboardingBlocked('Company listing is unavailable');
    if(String(source.supersededByCompanyId??listing)!==companyId)throw new OnboardingBlocked('Instrument company link requires review');
    const record=inst.exists?validateInstrument(inst.data() as Instrument):instrumentFromCompany(listing,source,companyId);
    if(!record||record.companyId!==companyId||record.providerSymbols.youanalyst!==listing)throw new OnboardingBlocked('Instrument company link changed');
    instrumentOnboardingIdentity(record,company);
    if(saved.exists){
      const current=parseOnboardingRequest(saved.data());if(current.instrumentId!==id||current.companyId!==companyId)throw new OnboardingBlocked('Onboarding identity mismatch');
      // Keep the original requester represented for staged/older job documents.
      const originalRef=ref.collection(REQUESTERS_COLLECTION).doc(requesterId(current.requestedByUid));
      const original=current.requestedByUid===requestedByUid?requester:await tx.get(originalRef);
      if(!original.exists)tx.create(originalRef,{requestedByUid:current.requestedByUid,requestedAt:current.requestedAt});
      if(current.requestedByUid!==requestedByUid&&!requester.exists)tx.create(requesterRef,{requestedByUid,requestedAt:new Date(now).toISOString()});
      return {instrumentId:id,companyId,status:current.status,created:false};
    }
    if(isSupportedCompany(company)&&record.onboarding?.status==='SUPPORTED')return {instrumentId:id,companyId,status:'SUPPORTED' as const,created:false};
    const request=createOnboardingRequest(id,record,company,requestedByUid,new Date(now));tx.create(ref,request);
    if(!requester.exists)tx.create(requesterRef,{requestedByUid,requestedAt:request.requestedAt});
    tx.set(instRef,{...(!inst.exists?{...record,createdAt:Timestamp.fromMillis(now)}:{}),onboarding:onboardingSummary('QUEUED',now,request.requestedAt),updatedAt:Timestamp.fromMillis(now)},{merge:true});
    if(!isSupportedCompany(company)&&!company.onboarding)tx.update(companyRef,{onboarding:onboardingSummary('QUEUED',now,request.requestedAt),updatedAt:Timestamp.fromMillis(now)});
    return {instrumentId:id,companyId,status:'QUEUED' as const,created:true};
  });
}

async function readiness(tx:Transaction,db:Firestore,request:OnboardingRequest){
  const [inst,owner]=await tx.getAll(db.collection('instruments').doc(request.instrumentId),db.collection('companies').doc(request.companyId));
  if(!inst.exists||!owner.exists)throw new OnboardingBlocked('Instrument or company no longer exists');
  const instrument=validateInstrument(inst.data() as Instrument),company=owner.data()!;
  if(instrument.companyId!==request.companyId)throw new OnboardingBlocked('Instrument company link changed');
  instrumentOnboardingIdentity(instrument,company);return {instrument,company};
}

/** One checkpoint, fenced leases, with issuer work serialized across its instruments. */
export async function processInstrumentOnboarding(db:Firestore,id:string,handlers:OnboardingHandlers,clock=Date.now){
  if(!validInstrumentId(id))throw Error('Invalid instrument ID');
  const ref=db.collection(ONBOARDING_COLLECTION).doc(id),owner=randomUUID();
  const claimed=await db.runTransaction(async tx=>{
    const saved=await tx.get(ref);if(!saved.exists)return null;
    const request=parseOnboardingRequest(saved.data());if(request.instrumentId!==id)throw Error('Request identity mismatch');
    if(['SUPPORTED','BLOCKED'].includes(request.status)||request.leaseExpiresAt>clock())return null;
    // A failed or interrupted step needs explicit admin retry, even on redelivery.
    if(request.lastError||request.status==='PROCESSING'){
      const [inst,company]=await tx.getAll(db.collection('instruments').doc(id),db.collection('companies').doc(request.companyId));
      const reason=request.lastError??'Worker interrupted; inspect before retrying';
      tx.set(ref,{...request,status:'BLOCKED',lastError:reason,nextAttemptAt:0,leaseOwner:null,leaseExpiresAt:0,updatedAt:new Date(clock()).toISOString()});
      if(inst.exists)tx.update(inst.ref,{onboarding:onboardingSummary('BLOCKED',clock(),request.requestedAt,inst.get('onboarding'),reason),updatedAt:Timestamp.fromMillis(clock())});
      const step=ONBOARDING_STEPS.find(key=>request.steps[key]!=='COMPLETE');
      if(company.exists&&step&&companyStep(step)&&!isSupportedCompany(company.data()!))tx.update(company.ref,{onboarding:onboardingSummary('BLOCKED',clock(),request.requestedAt,company.get('onboarding'),reason),updatedAt:Timestamp.fromMillis(clock())});
      return null;
    }
    if(request.nextAttemptAt>clock())return null;
    let context;
    try{context=await readiness(tx,db,request);}catch(error){
      if(!(error instanceof OnboardingBlocked))throw error;
      const inst=await tx.get(db.collection('instruments').doc(id));
      tx.set(ref,{...request,status:'BLOCKED',lastError:`identity: ${error.message}`,leaseOwner:null,leaseExpiresAt:0,nextAttemptAt:0,updatedAt:new Date(clock()).toISOString()});
      if(inst.exists)tx.update(inst.ref,{onboarding:onboardingSummary('BLOCKED',clock(),request.requestedAt,inst.get('onboarding'),error.message),updatedAt:Timestamp.fromMillis(clock())});
      return null;
    }
    const current={...request,steps:{...request.steps},status:'PROCESSING' as const,leaseOwner:owner,leaseExpiresAt:clock()+LEASE_MS,updatedAt:new Date(clock()).toISOString()};
    const through=createOnboardingRequest(id,context.instrument,context.company,request.requestedByUid,new Date(clock())).targetThrough;
    if(through>current.targetThrough){current.targetThrough=through;for(const key of ['corporateActions','prices','verify'] as const)delete current.steps[key];}
    const step=ONBOARDING_STEPS.find(key=>current.steps[key]!=='COMPLETE')??'verify';
    if(companyStep(step)){
      const siblings=await tx.get(db.collection(ONBOARDING_COLLECTION).where('companyId','==',request.companyId));
      if(siblings.docs.some(doc=>{const r=parseOnboardingRequest(doc.data());const active=ONBOARDING_STEPS.find(key=>r.steps[key]!=='COMPLETE');return doc.id!==id&&r.status==='PROCESSING'&&r.leaseExpiresAt>clock()&&active&&companyStep(active);}))return null;
    }
    tx.set(ref,current);
    tx.update(db.collection('instruments').doc(id),{onboarding:onboardingSummary('PROCESSING',clock(),request.requestedAt,context.instrument.onboarding),updatedAt:Timestamp.fromMillis(clock())});
    if(companyStep(step)&&!isSupportedCompany(context.company))tx.update(db.collection('companies').doc(request.companyId),{onboarding:onboardingSummary('PROCESSING',clock(),request.requestedAt,context.company.onboarding),updatedAt:Timestamp.fromMillis(clock())});
    return {...context,request:current,step};
  });
  if(!claimed)return {status:'SKIPPED' as const};
  const {step}=claimed;
  const guard=async()=>db.runTransaction(async tx=>{
    const current=parseOnboardingRequest((await tx.get(ref)).data());
    if(current.leaseOwner!==owner||current.leaseExpiresAt<=clock()||current.status!=='PROCESSING')throw Error('Onboarding lease lost');
    const fresh=await readiness(tx,db,current);
    if(!isDeepStrictEqual(instrumentFingerprint(fresh.instrument),instrumentFingerprint(claimed.instrument)))throw new OnboardingBlocked('Instrument identity changed during onboarding');
  });
  try{
    await guard();
    // Admission certifies enrollment and the shared presentation/routing steps.
    if(!(isSupportedCompany(claimed.company)&&companyStep(step)))await handlers[step]({...claimed,guard});
    await db.runTransaction(async tx=>{
      const current=parseOnboardingRequest((await tx.get(ref)).data());
      if(current.leaseOwner!==owner||current.leaseExpiresAt<=clock()||current.status!=='PROCESSING')throw Error('Onboarding lease lost');
      const fresh=await readiness(tx,db,current),steps={...current.steps,[step]:'COMPLETE' as const},done=ONBOARDING_STEPS.every(key=>steps[key]==='COMPLETE');
      if(!isDeepStrictEqual(instrumentFingerprint(fresh.instrument),instrumentFingerprint(claimed.instrument)))throw new OnboardingBlocked('Instrument identity changed during onboarding');
      if((step==='events'||done)&&!isDeepStrictEqual(companyFingerprint(fresh.company),companyFingerprint(claimed.company)))throw Error('Company readiness changed during verification');
      if(done&&(!isSupportedCompany(fresh.company)||step!=='verify'))throw Error('Company must be ready before instrument admission');
      if(done&&createOnboardingRequest(id,fresh.instrument,fresh.company,current.requestedByUid,new Date(clock())).targetThrough>current.targetThrough)throw Error('Onboarding needs a latest-session catchup');
      tx.set(ref,{...current,steps,status:done?'SUPPORTED':'QUEUED',attemptCount:0,nextAttemptAt:0,leaseOwner:null,leaseExpiresAt:0,lastError:null,updatedAt:new Date(clock()).toISOString()});
      tx.update(db.collection('instruments').doc(id),{onboarding:onboardingSummary(done?'SUPPORTED':'PROCESSING',clock(),current.requestedAt,fresh.instrument.onboarding),updatedAt:Timestamp.fromMillis(clock())});
      if(step==='events'&&COMPANY_STEPS.every(key=>steps[key]==='COMPLETE')&&!isSupportedCompany(fresh.company))tx.update(db.collection('companies').doc(current.companyId),{onboarding:onboardingSummary('SUPPORTED',clock(),current.requestedAt,fresh.company.onboarding),updatedAt:Timestamp.fromMillis(clock())});
    });
    return {status:step==='verify'?'SUPPORTED' as const:'CHECKPOINTED' as const,step};
  }catch(error){
    const publicReason=error instanceof OnboardingBlocked?error.message:`${step}: onboarding failed; explicit retry required`;
    const privateReason=maintenanceError(error).message.replace(/https?:\/\/[^\s]+/gi,'[provider URL]').replace(/(?:api_?key|api_token|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,'[credential redacted]').slice(0,1500);
    await db.runTransaction(async tx=>{
      const current=parseOnboardingRequest((await tx.get(ref)).data());if(current.leaseOwner!==owner||current.leaseExpiresAt<=clock())return;
      const [inst,company]=await tx.getAll(db.collection('instruments').doc(id),db.collection('companies').doc(current.companyId));
      const attemptCount=current.attemptCount+1;
      tx.set(ref,{...current,status:'BLOCKED',attemptCount,nextAttemptAt:0,leaseOwner:null,leaseExpiresAt:0,lastError:`${step}: ${privateReason}`,updatedAt:new Date(clock()).toISOString()});
      if(inst.exists)tx.update(inst.ref,{onboarding:onboardingSummary('BLOCKED',clock(),current.requestedAt,inst.get('onboarding'),publicReason),updatedAt:Timestamp.fromMillis(clock())});
      if(company.exists&&companyStep(step)&&!isSupportedCompany(company.data()!))tx.update(company.ref,{onboarding:onboardingSummary('BLOCKED',clock(),current.requestedAt,company.get('onboarding'),publicReason),updatedAt:Timestamp.fromMillis(clock())});
    });
    return {status:'INCOMPLETE' as const,step};
  }
}

/** Explicit one-time migration wake for a pre-trigger ready request. Never retries errors. */
export async function wakeInstrumentOnboarding(db:Firestore,id:string,now=Date.now()){
  if(!validInstrumentId(id))throw Error('Invalid instrument ID');
  const ref=db.collection(ONBOARDING_COLLECTION).doc(id);
  return db.runTransaction(async tx=>{
    const saved=await tx.get(ref);if(!saved.exists)return false;
    const row=parseOnboardingRequest(saved.data());
    if(row.instrumentId!==id)throw Error('Request identity mismatch');
    if(row.status!=='QUEUED'||row.lastError||row.leaseExpiresAt>now||row.nextAttemptAt>now)return false;
    tx.update(ref,{updatedAt:new Date(Math.max(now,Date.parse(row.updatedAt)+1)).toISOString()});
    return true;
  });
}

/** Retry only the first unfinished failed checkpoint; never reset completed work. */
export async function retryInstrumentOnboarding(db:Firestore,id:string,expected:{step:OnboardingStep;updatedAt:string},now=Date.now()){
  if(!validInstrumentId(id))throw Error('Invalid instrument ID');
  const ref=db.collection(ONBOARDING_COLLECTION).doc(id);
  return db.runTransaction(async tx=>{
    const doc=await tx.get(ref);if(!doc.exists)throw Error('Onboarding request does not exist');
    const request=parseOnboardingRequest(doc.data());const step=ONBOARDING_STEPS.find(key=>request.steps[key]!=='COMPLETE');
    if(request.instrumentId!==id||request.status==='SUPPORTED'||request.leaseExpiresAt>now||!request.lastError||request.updatedAt!==expected.updatedAt||step!==expected.step)throw Error('Request changed or is active; refresh before retrying');
    const fresh=await readiness(tx,db,request);
    tx.set(ref,{...request,status:'QUEUED',attemptCount:0,nextAttemptAt:0,lastError:null,leaseOwner:null,leaseExpiresAt:0,updatedAt:new Date(now).toISOString()});
    tx.update(db.collection('instruments').doc(id),{onboarding:onboardingSummary('PROCESSING',now,request.requestedAt,fresh.instrument.onboarding),updatedAt:Timestamp.fromMillis(now)});
    if(companyStep(step)&&!isSupportedCompany(fresh.company))tx.update(db.collection('companies').doc(request.companyId),{onboarding:onboardingSummary('PROCESSING',now,request.requestedAt,fresh.company.onboarding),updatedAt:Timestamp.fromMillis(now)});
    return {instrumentId:id,companyId:request.companyId,status:'QUEUED'};
  });
}
