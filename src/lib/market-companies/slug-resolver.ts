import 'server-only';
import {withCompanyPageReads} from '../local-cache/company-page-scope';
import { cache } from 'react';
import { getAdminFirestore } from '../firebase/admin';
import { inventoryCompanyPath } from './slug-inventory';
import { lookupCompanyRoute } from './slug-lookup';
import { readCompanyLookup } from '../company-lookup-cache';
import {timeCompanyPhase} from '../company-page-timing';
export const resolveCompanyRoute = cache((raw:string)=>timeCompanyPhase('identity',()=>withCompanyPageReads(()=>lookupCompanyRoute(raw,getAdminFirestore()))));
export const canonicalCompanyPath = cache((id:string) => withCompanyPageReads(async()=>{
  const db=getAdminFirestore();
  const doc=await readCompanyLookup(db,db.collection('companies').doc(id));
  return inventoryCompanyPath(id,doc.data()?.slug);
}));
