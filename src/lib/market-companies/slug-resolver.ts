import 'server-only';
import { cache } from 'react';
import { getAdminFirestore } from '../firebase/admin';
import { inventoryCompanyPath } from './slug-inventory';
import { lookupCompanyRoute } from './slug-lookup';
import { readCompanyLookup } from '../company-lookup-cache';
export const resolveCompanyRoute = cache((raw:string)=>lookupCompanyRoute(raw,getAdminFirestore()));
export const canonicalCompanyPath = cache(async (id:string) => {
  const db=getAdminFirestore();
  const doc=await readCompanyLookup(db,db.collection('companies').doc(id));
  return inventoryCompanyPath(id,doc.data()?.slug);
});
