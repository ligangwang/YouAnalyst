import type {Firestore} from 'firebase-admin/firestore';
import {validInstrumentId} from '../instruments/model';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,parseOnboardingRequest,type OnboardingRequest} from './model';

export type AdminOnboardingItem={request:OnboardingRequest;companyName:string;instrumentName:string;listing:string;companyStatus:string;instrumentStatus:string;step:string|null;canRetry:boolean};
export type AdminOnboardingPage={items:AdminOnboardingItem[];nextCursor:string|null};

/** Bounded pages, one single-field document-ID ordering; no composite index. */
export async function listInstrumentOnboarding(db:Firestore,cursor?:string,now=Date.now()):Promise<AdminOnboardingPage>{
  if(cursor&&!validInstrumentId(cursor))throw Error('Invalid cursor');
  let query=db.collection(ONBOARDING_COLLECTION).orderBy('__name__').limit(26);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get(),selected=page.docs.slice(0,25);
  if(!selected.length)return {items:[],nextCursor:null};
  const requests=selected.map(doc=>{const row=parseOnboardingRequest(doc.data());if(row.instrumentId!==doc.id)throw Error('Request identity mismatch');return row;});
  const refs=requests.flatMap(row=>[db.collection('instruments').doc(row.instrumentId),db.collection('companies').doc(row.companyId)]);
  const records=await db.getAll(...refs);
  return {items:requests.map((request,index)=>{
    const instrument=records[index*2].data()??{},company=records[index*2+1].data()??{};
    return {request:{...request,leaseOwner:null},companyName:String(company.name??request.companyId),instrumentName:String(instrument.name??request.instrumentId),listing:String(instrument.providerSymbols?.youanalyst??''),
      companyStatus:String(company.onboarding?.status??'DIRECTORY'),instrumentStatus:String(instrument.onboarding?.status??'DIRECTORY'),
      step:ONBOARDING_STEPS.find(step=>request.steps[step]!=='COMPLETE')??null,
      canRetry:request.status!=='SUPPORTED'&&Boolean(request.lastError)&&request.leaseExpiresAt<=now};
  }),nextCursor:page.docs.length>25?selected.at(-1)!.id:null};
}
