import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import {enableCompanyDirectoryForReader,companyDirectoryEnabled,withSharedCompanyQuery} from '../local-cache/company-directory';
import {isSupportedCompany} from './model';
import type {ThemedCompany} from '../company-themes/model';
import {exchangeRegion,type ExchangeRegion} from '../market-companies/exchange-region';

export const COLLECTION_COMPANY_FIELDS=['name','names','aliases','symbol','slug','country','listingStatus','listings',
  'status','isDeleted','supersededByCompanyId','onboarding.status','inGraph','themeMemberships'];

/** Shared memory -> snapshot -> watermark delta path; project only collector fields. */
export async function readCollectionCompanies(db:Firestore,extraFields:string[]=[],region?:ExchangeRegion):Promise<ThemedCompany[]>{
  enableCompanyDirectoryForReader(db,['companies']);
  return withSharedCompanyQuery(async()=>{
    let base=db.collection('companies').where('onboarding.status','==','SUPPORTED')
      .orderBy(FieldPath.documentId()).select(...new Set([...COLLECTION_COMPANY_FIELDS,...extraFields]));
    // Canonical listing prefixes bound the scan without a new composite index.
    if(region)base=base.where(FieldPath.documentId(),'>=',region==='US'?'US:':'XSHE:')
      .where(FieldPath.documentId(),'<',region==='US'?'US;':'XSHG;');
    if(companyDirectoryEnabled(db)){
      const page=await base.get();
      return page.docs.flatMap(doc=>{const data=doc.data();return isSupportedCompany(data)&&(!region||exchangeRegion(doc.id)===region)?[{...data,id:doc.id} as ThemedCompany]:[];});
    }
    const records:ThemedCompany[]=[];let cursor:string|undefined;
    for(;;){
      const page=await(cursor?base.startAfter(cursor):base).limit(250).get();
      for(const doc of page.docs){const data=doc.data();if(isSupportedCompany(data)&&(!region||exchangeRegion(doc.id)===region))records.push({...data,id:doc.id} as ThemedCompany);}
      if(page.size<250)break;
      cursor=page.docs.at(-1)!.id;
    }
    return records;
  });
}

export const SEC_COLLECTION_FIELDS=['cik','taxonomy','classification','classificationMetadata'];

/** Single-company tasks reuse the same directory as the dispatcher. */
export async function readSecCollectionCompany(db:Firestore,id:string){
  enableCompanyDirectoryForReader(db,['companies']);
  const [doc]=await db.getAll(db.collection('companies').doc(id),
    {fieldMask:[...COLLECTION_COMPANY_FIELDS,...SEC_COLLECTION_FIELDS]});
  return doc.exists?{...doc.data(),id} as ThemedCompany:undefined;
}
