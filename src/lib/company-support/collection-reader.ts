import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import {withLiveCompanyReads} from '../local-cache/company-directory';
import {isSupportedCompany} from './model';
import type {ThemedCompany} from '../company-themes/model';

export const COLLECTION_COMPANY_FIELDS=['name','names','aliases','symbol','slug','country','listingStatus','listings',
  'status','isDeleted','supersededByCompanyId','onboarding.status','inGraph','themeMemberships'];

/** One-shot workers need a small current projection, not a browser directory
 * containing search indexes and retained live snapshots. Page SDK reads so only
 * the projected records survive between pages. */
export async function readCollectionCompanies(db:Firestore,extraFields:string[]=[]):Promise<ThemedCompany[]>{
  return withLiveCompanyReads(async()=>{
    const base=db.collection('companies').where('onboarding.status','==','SUPPORTED')
      .orderBy(FieldPath.documentId()).select(...new Set([...COLLECTION_COMPANY_FIELDS,...extraFields]));
    const records:ThemedCompany[]=[];let cursor:string|undefined;
    for(;;){
      const page=await(cursor?base.startAfter(cursor):base).limit(250).get();
      for(const doc of page.docs){const data=doc.data();if(isSupportedCompany(data))records.push({...data,id:doc.id} as ThemedCompany);}
      if(page.size<250)break;
      cursor=page.docs.at(-1)!.id;
    }
    return records;
  });
}
