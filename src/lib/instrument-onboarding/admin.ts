import {completedCatalog,completedPage,usesHistoryCatalog} from './completed-history';
import type {Firestore} from 'firebase-admin/firestore';
import {validInstrumentId} from '../instruments/model';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,parseOnboardingRequest,type OnboardingRequest} from './model';
import {ONBOARDING_FILTERS,type OnboardingFilter} from './progress';
import {listSupportedUnthemedCompanies,type SupportedUnthemedCompany} from './unthemed-companies';

export type AdminOnboardingItem={request:OnboardingRequest;companyName:string;instrumentName:string;listing:string;companyStatus:string;instrumentStatus:string;step:string|null;canRetry:boolean};
export type AdminOnboardingPage={items:AdminOnboardingItem[];companies?:SupportedUnthemedCompany[];nextCursor:string|null};

/** Filter before paging, using existing automatic single-field indexes only. */
export async function listInstrumentOnboarding(db:Firestore,cursor?:string,now=Date.now(),filter:OnboardingFilter='ALL'):Promise<AdminOnboardingPage>{
  if(!ONBOARDING_FILTERS.includes(filter))throw Error('Invalid filter');
  if(filter==='SUPPORTED_NO_THEMES')return listSupportedUnthemedCompanies(db,cursor);
  if(cursor&&!validInstrumentId(cursor))throw Error('Invalid cursor');
  const collection=db.collection(ONBOARDING_COLLECTION);
  let query=filter==='ERRORS'?collection.where('lastError','!=',null).orderBy('lastError').limit(26)
    :(filter!=='ALL'?collection.where('status','==',filter):collection).orderBy('__name__').limit(26);
  if(cursor){
    if(filter==='ERRORS'){
      // A snapshot cursor includes the error ordering value plus document ID,
      // keeping equal-error pages stable without exposing errors in cursor URLs.
      const previous=await collection.doc(cursor).get();
      if(!previous.exists||typeof previous.get('lastError')!=='string')throw Error('Request changed; refresh before paging');
      query=query.startAfter(previous);
    }else query=query.startAfter(cursor);
  }
  let entries;
  if((filter==='ALL'||filter==='SUPPORTED')&&usesHistoryCatalog()){
    const {catalog,page}=await db.runTransaction(async tx=>({
      catalog:await completedCatalog(db,tx),page:await tx.get(query),
    }),{readOnly:true});
    const archived=catalog?await completedPage(catalog,cursor,26):[];
    const merged=new Map(archived.map(row=>[row.id,row]));
    for(const doc of page.docs)merged.set(doc.id,{id:doc.id,data:doc.data()});
    entries=[...merged.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
  }else entries=(await query.get()).docs.map(doc=>({id:doc.id,data:doc.data()}));
  const selected=entries.slice(0,25);
  if(!selected.length)return {items:[],nextCursor:null};
  const requests=selected.map(doc=>{const row=parseOnboardingRequest(doc.data);if(row.instrumentId!==doc.id)throw Error('Request identity mismatch');return row;});
  const refs=requests.flatMap(row=>[db.collection('instruments').doc(row.instrumentId),db.collection('companies').doc(row.companyId)]);
  const records=await db.getAll(...refs);
  return {items:requests.map((request,index)=>{
    const instrument=records[index*2].data()??{},company=records[index*2+1].data()??{};
    return {request:{...request,leaseOwner:null},companyName:String(company.name??request.companyId),instrumentName:String(instrument.name??request.instrumentId),listing:String(instrument.providerSymbols?.youanalyst??''),
      companyStatus:String(company.onboarding?.status??'DIRECTORY'),instrumentStatus:String(instrument.onboarding?.status??'DIRECTORY'),
      step:ONBOARDING_STEPS.find(step=>request.steps[step]!=='COMPLETE')??null,
      canRetry:request.status!=='SUPPORTED'&&Boolean(request.lastError)&&request.leaseExpiresAt<=now};
  }),nextCursor:entries.length>25?selected.at(-1)!.id:null};
}
