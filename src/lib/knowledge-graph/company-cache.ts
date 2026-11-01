import { localDocuments } from '../local-cache/entities';
import type { Firestore } from 'firebase-admin/firestore';
import { GRAPH_COMPANY_FIELDS, queryThemeCompanies,themeIdBatches } from '../company-themes/company-query';
import { withCompanyPageReads } from '../local-cache/company-page-scope';
import { collectionSourceSnapshot } from '../local-cache/read-scope';

/** A themed graph needs only its own members. Share its live subscription across
 * callers without downloading the market directory or subscribing to all themes. */
export async function loadSingleThemeCompanies(db: Firestore, theme: string) {
  return withCompanyPageReads(async () => {
    const query = db.collection('companies').where('themeIds', 'array-contains', theme);
    const {docs} = await (collectionSourceSnapshot(db, query, 'companies')
      ?? query.select(...GRAPH_COMPANY_FIELDS).get()) as Awaited<ReturnType<typeof query.get>>;
    return {docs: docs.filter(doc => doc.data()?.isDeleted !== true)};
  });
}
export async function loadThemeEnrolledCompanies(db: Firestore,targeted=false) {
  if(targeted)return withCompanyPageReads(async()=>{
    const pages=await Promise.all((await themeIdBatches(db)).map(async ids=>{
      const query=db.collection('companies').where('themeIds','array-contains-any',ids);
      return await collectionSourceSnapshot(db,query,'companies')??await query.select(...GRAPH_COMPANY_FIELDS,'newsSources','onboarding','supersededByCompanyId').get();
    }));
    return {docs:[...new Map(pages.flatMap(page=>page.docs.map((doc:import('firebase-admin/firestore').QueryDocumentSnapshot)=>[doc.id,doc] as const))).values()].filter(doc=>doc.data()?.isDeleted!==true)};
  });
  const local = await localDocuments(db, 'companies', undefined, undefined, 'graph');
  return local ? {docs:local} : queryThemeCompanies(db,undefined,true);
}
