import { localDocuments, localQuery } from '../local-cache/entities';
import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
export async function loadAllRelationships(db: Firestore) {
  const local = await localDocuments(db,'company_relationships');
  return local ? {docs:local as QueryDocumentSnapshot[]} : db.collection('company_relationships').get();
}
async function selected(db:Firestore,key:string,query:Query){
  const docs=typeof query.onSnapshot==='function'
    ? [...(await localQuery(db,`relationships:${key}`,query,'company_relationships')).values()]
    : (await query.get()).docs;
  return docs.filter(doc=>doc.data()?.isDeleted!==true) as QueryDocumentSnapshot[];
}
export async function loadPublishedRelationships(db: Firestore) {
  return {docs:await selected(db,'published',db.collection('company_relationships').where('status','==','PUBLISHED'))};
}
/** Untagged historical relationships retain their AI placement. Explicit decisions are authoritative. */
export function relationshipBelongsToTheme(row: Record<string, unknown>, theme: string) {
  return Array.isArray(row.themeIds) ? row.themeIds.includes(theme) : theme === 'ai';
}
export async function loadThemeRelationships(db: Firestore, theme: string) {
  return {docs:await selected(db,`theme:${JSON.stringify(theme)}`,db.collection('company_relationships').where('themeIds','array-contains',theme))};
}
export async function loadCompanyRelationships(db: Firestore, companyIds: readonly string[], exactIds: readonly string[] = []) {
  const found=new Map<string,QueryDocumentSnapshot>(),source=db.collection('company_relationships');
  const ids=[...new Set(companyIds)].sort();
  for(const field of ['source','target'])for(let i=0;i<ids.length;i+=30){
    const batch=ids.slice(i,i+30);
    for(const doc of await selected(db,JSON.stringify([field,batch]),source.where(field,'in',batch)))found.set(doc.id,doc);
  }
  // Exact keys retain suppressed or corrupt records even when endpoints changed.
  const exact=[...new Set(exactIds)].sort();
  const {FieldPath}=await import('firebase-admin/firestore');
  for(let i=0;i<exact.length;i+=30){
    const batch=exact.slice(i,i+30);
    for(const doc of await selected(db,JSON.stringify(['ids',batch]),source.where(FieldPath.documentId(),'in',batch)))found.set(doc.id,doc);
  }
  return {docs:[...found.values()]};
}
export async function loadFilingRelationships(db: Firestore, prefix: string, limit = 100) {
  const lower=Buffer.from(prefix), upper=Buffer.from(prefix+'\uf8ff');
  return {docs:(await loadAllRelationships(db)).docs.filter(doc => Buffer.compare(Buffer.from(doc.id),lower)>=0 && Buffer.compare(Buffer.from(doc.id),upper)<0)
    .sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(0,limit)};
}
