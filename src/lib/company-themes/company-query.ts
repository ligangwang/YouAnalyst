import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { ExchangeRegion } from '../market-companies/exchange-region';
import { loadThemeCatalog } from './catalog';
import { catalogThemeIds } from './catalog-model';

/** Firestore limits array-contains-any to 30 disjunctions. Never truncate a growing catalog. */
export async function themeIdBatches(db: Firestore) {
  const ids=catalogThemeIds(await loadThemeCatalog(db));
  const batches:string[][]=[];
  for(let i=0;i<ids.length;i+=30)batches.push(ids.slice(i,i+30));
  return batches;
}
export async function queryThemeCompanies(db:Firestore,region?:ExchangeRegion){
  const found=new Map<string,QueryDocumentSnapshot>();
  for(const ids of await themeIdBatches(db)){
    let query=db.collection('companies').where('themeIds','array-contains-any',ids);
    if(region)query=query.where('exchange_region','==',region);
    for(const doc of (await query.get()).docs)found.set(doc.id,doc);
  }
  return {docs:[...found.values()]};
}
