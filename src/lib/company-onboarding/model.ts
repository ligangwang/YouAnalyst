import {historyThrough} from '../predictions/history-range';
import {predictionInstrument} from '../predictions/instrument';

export const ONBOARDING_COLLECTION='company_onboarding_requests';
export const ONBOARDING_START='2020-12-30';
export const ONBOARDING_STEPS=['identity','themes','profile','corporateActions','prices','fundamentals','metrics','graph','events','verify'] as const;
export type OnboardingStep=typeof ONBOARDING_STEPS[number];
export type OnboardingRequest={
  companyId:string;version:1;status:'QUEUED'|'PROCESSING'|'BLOCKED'|'SUPPORTED';
  requestedAt:string;updatedAt:string;targetThrough:string;
  steps:Partial<Record<OnboardingStep,'COMPLETE'>>;attemptCount:number;nextAttemptAt:number;
  leaseOwner:string|null;leaseExpiresAt:number;lastError:string|null;
};
export class OnboardingBlocked extends Error {}
export const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;

export function onboardingIdentity(companyId:string,company:Record<string,unknown>){
  if(company.supersededByCompanyId||company.listingStatus==='PRIVATE')throw new OnboardingBlocked('Company is not an eligible public listing');
  if(company.isDeleted===true||!['PUBLISHED','DIRECTORY'].includes(String(company.status))||typeof company.name!=='string'||!company.name.trim())throw new OnboardingBlocked('Company profile is not public');
  if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))throw new OnboardingBlocked('Listing is not supported by the onboarding providers');
  const instrument=predictionInstrument(companyId.startsWith('US:')?companyId.slice(3):companyId);
  if(!instrument)throw new OnboardingBlocked('Provider listing identity is unavailable');
  let cik:string|null=null;
  if(instrument.market==='US'){
    const value=String(company.cik??'');
    if(!/^\d{1,10}$/.test(value)||Number(value)===0)throw new OnboardingBlocked('CIK not matched');
    cik=value.padStart(10,'0');
  }
  return {instrument,cik};
}

export function createOnboardingRequest(companyId:string,company:Record<string,unknown>,now=new Date()):OnboardingRequest{
  const {instrument}=onboardingIdentity(companyId,company),at=now.toISOString();
  return {companyId,version:1,status:'QUEUED',requestedAt:at,updatedAt:at,targetThrough:historyThrough(instrument.market,now),
    steps:{},attemptCount:0,nextAttemptAt:0,leaseOwner:null,leaseExpiresAt:0,lastError:null};
}

export function parseOnboardingRequest(value:unknown):OnboardingRequest{
  const v=value as OnboardingRequest;
  if(!v||v.version!==1||typeof v.companyId!=='string'||!['QUEUED','PROCESSING','BLOCKED','SUPPORTED'].includes(v.status)
    ||!validDay(v.targetThrough)||v.targetThrough<ONBOARDING_START||!Number.isFinite(Date.parse(v.requestedAt))
    ||!v.steps||typeof v.steps!=='object'||Array.isArray(v.steps)||Object.entries(v.steps).some(([k,s])=>!ONBOARDING_STEPS.includes(k as OnboardingStep)||s!=='COMPLETE')
    ||!Number.isSafeInteger(v.attemptCount)||v.attemptCount<0||!Number.isFinite(v.nextAttemptAt)||!Number.isFinite(v.leaseExpiresAt))throw Error('Invalid onboarding request');
  return v;
}
