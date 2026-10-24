import {withCompanyPageReads} from '../local-cache/company-page-scope';
import { loadCompanyDocuments } from '../company-document-cache';
import { loadPeerPrices } from './price-cache';
import { getAdminFirestore } from '../firebase/admin';
import { loadThemeGraph } from '../company-themes/graph-service';
import { loadThemeCatalog } from '../company-themes/catalog';
import { catalogThemeIds } from '../company-themes/catalog-model';
import { marketDate } from '../predictions/instrument';
import { buildPeerComparison, type PeerComparison } from './model';
import {findPeerThemeGroup} from './theme-group';
import type {ThemedCompany} from '../company-themes/model';
import {changeCached} from '../change-cache';

/** Read existing caches only. Comparison views never enqueue provider requests or create collections. */
export async function loadPeerComparison(companyId:string):Promise<PeerComparison|null>{
 if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))return null;
 const db=getAdminFirestore();
 let complete=true;
 // Date is an input to the comparison, not a cache-expiry timer.
 const dateKey=[marketDate('US'),marketDate('CN_A')].join(':');
 try{return await withCompanyPageReads(()=>changeCached(db,`peers:${companyId}:${dateKey}`,['companies','company_relationships','company_fundamentals','eod_prices'],async()=>{
  const [catalog,documents]=await Promise.all([loadThemeCatalog(db),loadCompanyDocuments(db,'companies',[companyId])]);
  const selected=await findPeerThemeGroup(companyId,documents[0]?.data() as Partial<ThemedCompany>|undefined,
   catalogThemeIds(catalog),theme=>loadThemeGraph(theme).catch(()=>{complete=false;return null;}));
  if(selected){
   const {graph,group}=selected;
   const financials=new Map<string,unknown>(),prices=new Map<string,Record<string,unknown>[]>(),today=marketDate(group.market);
   for(let i=0;i<group.companies.length;i+=100){
    const batch=group.companies.slice(i,i+100);
    const docs=await loadCompanyDocuments(db,'company_fundamentals',batch.map(c=>c.id)).catch(()=>{complete=false;return [];});
    docs.forEach((doc,index)=>financials.set(batch[index].id,doc.data()));
   }
   // Bound concurrent reads while retaining every member of the published comparison group.
   for(let i=0;i<group.companies.length;i+=8)await Promise.all(group.companies.slice(i,i+8).map(async company=>{
    const rows=await loadPeerPrices(db,company.id,group.market,today).catch(()=>{complete=false;return [];});
    prices.set(company.id,rows);
   }));
   return buildPeerComparison(companyId,graph.nodes,financials,prices,today);
  }
  return null;
 },()=>complete));}
 catch(error){console.error('Company peer comparison unavailable',error);return null;}
}
