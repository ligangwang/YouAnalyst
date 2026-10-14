import 'server-only';
import { cache } from 'react';
import { getAdminFirestore } from '../firebase/admin';
import { companySlugPath } from './slugs';
import { lookupCompanyRoute } from './slug-lookup';
export const resolveCompanyRoute = cache((raw:string)=>lookupCompanyRoute(raw,getAdminFirestore()));
export const canonicalCompanyPath = cache(async (id:string) => {
  const doc=await getAdminFirestore().collection('companies').doc(id).get();
  return companySlugPath(id,doc.data()?.slug);
});
