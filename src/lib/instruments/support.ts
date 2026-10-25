import {isSupportedCompany} from '../company-support/model';
import type {Instrument} from './model';

/** Issuer support alone never admits a new listing to price/action maintenance. */
export function isSupportedInstrument(record:Instrument,company:Record<string,unknown>){
  return (record as Instrument&{isDeleted?:boolean}).isDeleted!==true&&record.status!=='DELISTED'
    &&record.onboarding?.status==='SUPPORTED'&&isSupportedCompany(company);
}
