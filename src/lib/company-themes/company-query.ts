import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { ExchangeRegion } from '../market-companies/exchange-region';
import { loadThemeCatalog } from './catalog';
import { catalogThemeIds } from './catalog-model';

/** Graph readers never use search indexes or collector/onboarding payloads.
 * Project before snapshot.data(): copying a full SQLite document decompresses
 * its searchPrefixes synchronously on the website's event loop. */
export const GRAPH_COMPANY_FIELDS = ['name','status','slug','symbol','names','aliases',
  'country','listingStatus','listings','description','descriptionTranslations',
  'editorialReviewedAt','privateValuationCheck','inGraph','themeIds','themeMemberships',
  'isDeleted','exchange_region'] as const;

/** Firestore limits array-contains-any to 30 disjunctions. Never truncate a growing catalog. */
export async function themeIdBatches(db: Firestore) {
  const ids=catalogThemeIds(await loadThemeCatalog(db));
  const batches:string[][]=[];
  for(let i=0;i<ids.length;i+=30)batches.push(ids.slice(i,i+30));
  return batches;
}
export async function queryThemeCompanies(db:Firestore,region?:ExchangeRegion,graph=false){
  const found=new Map<string,QueryDocumentSnapshot>();
  for(const ids of await themeIdBatches(db)){
    let query=db.collection('companies').where('themeIds','array-contains-any',ids);
    if(region)query=query.where('exchange_region','==',region);
    if(graph)query=query.select(...GRAPH_COMPANY_FIELDS);
    for(const doc of (await query.get()).docs)found.set(doc.id,doc);
  }
  return {docs:[...found.values()]};
}
