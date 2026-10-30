import {withCompanyPageReads} from '../local-cache/company-page-scope';
import { loadCompanyDocuments } from '../company-document-cache';
import { loadPeerPrices } from './price-cache';
import { getAdminFirestore } from '../firebase/admin';
import { loadThemeGraphStructure } from '../company-themes/graph-service';
import { loadThemeCatalog } from '../company-themes/catalog';
import { catalogThemeIds } from '../company-themes/catalog-model';
import { marketDate } from '../predictions/instrument';
import { buildPeerComparison, type PeerComparison } from './model';
import {findPeerThemeGroup} from './theme-group';
import type {ThemedCompany} from '../company-themes/model';
import {changeCached} from '../change-cache';
import {normalizePriceDemand} from './price-demand';
import {timeCompanyPhase} from '../company-page-timing';

/** Read existing caches only. Comparison views never enqueue provider requests or create collections. */
export async function loadPeerComparison(companyId:string,options:{company?:Record<string,unknown>;aiEligible?:boolean;priceIds?:string[];signal?:AbortSignal}={}):Promise<PeerComparison|null>{
 if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))return null;
 const demand=options.priceIds===undefined?undefined:normalizePriceDemand(companyId,options.priceIds);
 if(options.priceIds!==undefined&&!demand)return null;
 const db=getAdminFirestore();
 let complete=true;
 // Date is an input to the comparison, not a cache-expiry timer.
 const dateKey=[marketDate('US'),marketDate('CN_A')].join(':');
 try{return await withCompanyPageReads(()=>changeCached(db,`peers:${companyId}:${dateKey}:${demand?.join(",")??"financials"}`,['companies','company_relationships','company_fundamentals','eod_prices'],async()=>{
  const [catalog,documents]=await Promise.all([loadThemeCatalog(db),options.company?Promise.resolve([{data:()=>options.company}]):loadCompanyDocuments(db,'companies',[companyId])]);
  const selected=await findPeerThemeGroup(companyId,documents[0]?.data() as Partial<ThemedCompany>|undefined,
   catalogThemeIds(catalog).filter(theme=>theme!=='ai'||options.aiEligible!==false),theme=>loadThemeGraphStructure(theme).catch(()=>{complete=false;return null;}));
  if(selected){
   const {graph,group}=selected;
   const financials=new Map<string,unknown>(),prices=new Map<string,Record<string,unknown>[]>(),today=marketDate(group.market);
   if(demand){
    // Validate the entire request before touching any price files or listeners.
    if(demand.some(id=>!group.companies.some(company=>company.id===id)))return null;
    await timeCompanyPhase('peer_prices',async()=>{
     for(let i=0;i<demand.length;i+=8){
      options.signal?.throwIfAborted();
      await Promise.all(demand.slice(i,i+8).map(async id=>{
       // Propagate failures: partial results must not masquerade as a complete sample.
       prices.set(id,await loadPeerPrices(db,id,group.market,today));
      }));
     }
    });
   }else await timeCompanyPhase('peer_financials',async()=>{
    for(let i=0;i<group.companies.length;i+=100){
     const batch=group.companies.slice(i,i+100);
     const docs=await loadCompanyDocuments(db,'company_fundamentals',batch.map(c=>c.id)).catch(()=>{complete=false;return [];});
     docs.forEach((doc,index)=>financials.set(batch[index].id,doc.data()));
    }
   });
   const result=buildPeerComparison(companyId,demand?graph.nodes.filter(node=>demand.includes(node.id)):graph.nodes,financials,prices,today);
   // Companies without financial observations can still opt into price returns.
   if(result&&!demand&&result.panels.length===0)result.pricePeers=group.companies.map(({id,name,names,symbol,slug})=>({id,name,names,symbol,slug}));
   return result;
  }
  return null;
 },()=>complete));}
 catch(error){if(!options.signal?.aborted)console.error('Company peer comparison unavailable',error);return null;}
}
