import type {Firestore,DocumentData} from 'firebase-admin/firestore';
import type {CompanyFundamentals} from '../fundamentals/model';
import {resolveInstrumentContext} from './service';
import {requestMissingCompanyFundamentals} from '../fundamentals/service';
import {loadFundamentalsSnapshot} from '../fundamentals/document-cache';
import {readCnFundamentals} from '../fundamentals/cn-service';

export function financialsForInstrument(companyValue:CompanyFundamentals,stored?:DocumentData) {
  const {marketCap: _marketCap,shareAssessment: _shareAssessment,...financials}=companyValue;
  void _marketCap;void _shareAssessment;
  return {...financials,
    ...(stored?.isDeleted!==true&&stored?.marketCap?{marketCap:stored.marketCap}:{}),
    ...(stored?.isDeleted!==true&&stored?.value?.shareAssessment?{shareAssessment:stored.value.shareAssessment}:{})};
}

/** Reuse issuer reports while preserving security-specific valuation/share data. */
export async function instrumentFundamentals(db:Firestore,instrumentId:string) {
  const context=await resolveInstrumentContext(db,instrumentId);
  if(!context)return null;
  const legacy=context.historyKey,companyId=context.company.id;
  if(!legacy)return null;
  if(legacy.startsWith('US:')&&companyId.startsWith('US:')){
    const companyValue=await requestMissingCompanyFundamentals(companyId.slice(3),db);
    if(!companyValue)return {instrumentId:context.instrument.id,companyId,data:null};
    if(legacy===companyId)return {instrumentId:context.instrument.id,companyId,data:companyValue};
    const instrumentSnapshot=await loadFundamentalsSnapshot(db,legacy);
    const stored=instrumentSnapshot.data();
    // Never apply the canonical stock's share assessment or market cap to another class.
    return {instrumentId:context.instrument.id,companyId,data:financialsForInstrument(companyValue,stored)};
  }
  if(/^(XSHG|XSHE):/.test(legacy)&&legacy===companyId)return {instrumentId:context.instrument.id,companyId,data:await readCnFundamentals(legacy,db)};
  return {instrumentId:context.instrument.id,companyId,data:null};
}
