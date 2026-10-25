import {instrumentOnboardingIdentity} from './model';
import {instrumentFromCompany,type Instrument} from '../instruments/model';
import {isSupportedInstrument} from '../instruments/support';

export type CompanySupportState='SUPPORTED'|'QUEUED'|'PROCESSING'|'BLOCKED'|'ELIGIBLE'|'CIK_UNMATCHED'|'UNAVAILABLE';

/** An issuer's readiness is not the readiness of every instrument it issues. */
export function companySupportState(id:string,source:Record<string,unknown>,stored?:Instrument,owner?:Record<string,unknown>):CompanySupportState{
  if(source.isDeleted||source.listingStatus==='PRIVATE'||!['PUBLISHED','DIRECTORY'].includes(String(source.status)))return 'UNAVAILABLE';
  const company=owner??(source.supersededByCompanyId?undefined:source);if(!company)return 'UNAVAILABLE';
  const record=stored??instrumentFromCompany(id,source,String(source.supersededByCompanyId??id));if(!record)return 'UNAVAILABLE';
  try{instrumentOnboardingIdentity(record,company);}catch(error){return error instanceof Error&&error.message==='CIK not matched'?'CIK_UNMATCHED':'UNAVAILABLE';}
  if(isSupportedInstrument(record,company))return 'SUPPORTED';
  const status=record.onboarding?.status;
  if(status==='QUEUED'||status==='PROCESSING'||status==='BLOCKED')return status;
  return 'ELIGIBLE';
}
