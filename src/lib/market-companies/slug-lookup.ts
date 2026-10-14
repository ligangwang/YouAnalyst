import type { Firestore } from 'firebase-admin/firestore';
import { companyIdFromSlug, companySlugPath, organizationCompanyId, publicCompanyTicker } from './slugs';
import { chinaCompanyId } from './routes';

// A missing record never creates a company or triggers paid research.
export async function lookupCompanyRoute(raw:string, db:Firestore) {
  let key:string;
  try { key=decodeURIComponent(raw); } catch { return null; }
  if (!key || key.length>160 || /[/?#]/.test(key)) return null;
  const collection=db.collection('companies');
  const id=companyIdFromSlug(key) ?? organizationCompanyId(key) ?? (publicCompanyTicker(key)?`US:${publicCompanyTicker(key)}`:null)
    ?? (/^(?:US:|ORG:)/i.test(key)?key.toUpperCase():chinaCompanyId(key));
  if (id) {
    const doc=await collection.doc(id).get(), data=doc.data();
    return {id,data,path:companySlugPath(id,data?.slug)};
  }
  const slug=key.toLowerCase();
  let docs=(await collection.where('slug','==',slug).limit(2).get()).docs;
  if (!docs.length) docs=(await collection.where('slugAliases','array-contains',slug).limit(2).get()).docs;
  if (docs.length!==1) return null;
  const doc=docs[0], data=doc.data();
  return {id:doc.id,data,path:companySlugPath(doc.id,data.slug)};
}
