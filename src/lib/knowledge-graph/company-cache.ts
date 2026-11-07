import { localDocuments } from '../local-cache/entities';
import type { Firestore, Query, DocumentSnapshot } from 'firebase-admin/firestore';
import { GRAPH_COMPANY_FIELDS, queryThemeCompanies,themeIdBatches } from '../company-themes/company-query';
import { withCompanyPageReads } from '../local-cache/company-page-scope';
import { sourceSnapshot } from '../local-cache/read-scope';
import {loadPublishedGraphCompanies} from '../local-cache/graph-companies';

declare global {var __themeGraphSourceOwnersV1:WeakMap<Firestore,object>|undefined;}
const themeFields=[...GRAPH_COMPANY_FIELDS,'newsSources','onboarding','supersededByCompanyId'];
const themeOwners=globalThis.__themeGraphSourceOwnersV1??=new WeakMap<Firestore,object>();
function graphDocument(doc:DocumentSnapshot):DocumentSnapshot {
 const data=Object.fromEntries(themeFields.flatMap(field=>{
  const value=typeof doc.get==='function'?doc.get(field):doc.data()?.[field];
  return value===undefined?[]:[[field,value]];
 }));
 return {id:doc.id,exists:doc.exists,ref:doc.ref,readTime:doc.readTime,
  data:()=>structuredClone(data),get:(field:string)=>structuredClone(field.split('.').reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined,data))} as DocumentSnapshot;
}
function graphSource(query:Query){
 return {query,isEqual:(other:{query:Query})=>query.isEqual(other.query),
  onSnapshot:(next:(snapshot:{docs:DocumentSnapshot[]})=>void,error:(reason:Error)=>void)=>
   query.onSnapshot(snapshot=>next({docs:snapshot.docs.map(graphDocument)}),error)};
}

/** A themed graph needs only its own members. Share its live subscription across
 * callers without downloading the market directory or subscribing to all themes. */
export async function loadSingleThemeCompanies(db: Firestore, theme: string) {
  return withCompanyPageReads(async () => {
    const query = db.collection('companies').where('themeIds', 'array-contains', theme);
    let owner=themeOwners.get(db);if(!owner){owner={};themeOwners.set(db,owner);}
    // Retain projected graph data, not full search payloads. Keep the
    // same byte/listener bounds in a separate partition from full-company reads.
    const source=typeof query.onSnapshot==='function'&&typeof query.isEqual==='function'?graphSource(query):undefined;
    const {docs} = await ((source?sourceSnapshot(owner,source,1024,32*1024*1024):undefined)
      ?? query.select(...themeFields).get()) as Awaited<ReturnType<typeof query.get>>;
    return {docs: docs.filter(doc => doc.data()?.isDeleted !== true)};
  });
}
export async function loadThemeEnrolledCompanies(db: Firestore,targeted=false) {
  if(targeted)return withCompanyPageReads(async()=>{
    const [batches,docs]=await Promise.all([themeIdBatches(db),loadPublishedGraphCompanies(db)]),themes=new Set(batches.flat());
    return {docs:docs.filter(doc=>{const ids=doc.get('themeIds');return Array.isArray(ids)&&ids.some(id=>themes.has(id));})};
  });
  const local = await localDocuments(db, 'companies', undefined, undefined, 'graph');
  return local ? {docs:local} : queryThemeCompanies(db,undefined,true);
}
