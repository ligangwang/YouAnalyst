import {onboardingIdentity} from './model';
import {isSupportedCompany} from '../company-support/model';

export type CompanySupportState='SUPPORTED'|'QUEUED'|'PROCESSING'|'BLOCKED'|'ELIGIBLE'|'CIK_UNMATCHED'|'UNAVAILABLE';

/** Public directory summary only; never exposes queue errors or lease metadata. */
export function companySupportState(id:string,company:Record<string,unknown>):CompanySupportState{
  if(isSupportedCompany(company))return 'SUPPORTED';
  if(company.supersededByCompanyId||company.listingStatus==='PRIVATE')return 'UNAVAILABLE';
  const status=(company.onboarding as {status?:unknown}|undefined)?.status;
  if(status==='QUEUED'||status==='PROCESSING'||status==='BLOCKED')return status;
  try{onboardingIdentity(id,company);return 'ELIGIBLE';}
  catch(error){return error instanceof Error&&error.message==='CIK not matched'?'CIK_UNMATCHED':'UNAVAILABLE';}
}
