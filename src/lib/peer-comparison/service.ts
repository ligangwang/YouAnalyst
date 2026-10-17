import { FieldPath } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { loadThemeGraph } from '../company-themes/graph-service';
import { COMPANY_THEMES } from '../company-themes/model';
import { marketDate } from '../predictions/instrument';
import { buildPeerComparison, peerGroup, type PeerComparison } from './model';
import {changeCached} from '../change-cache';

/** Read existing caches only. Comparison views never enqueue provider requests or create collections. */
export async function loadPeerComparison(companyId:string):Promise<PeerComparison|null>{
 if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))return null;
 const db=getAdminFirestore();
 let complete=true;
 // Date is an input to the comparison, not a cache-expiry timer.
 const dateKey=[marketDate('US'),marketDate('CN_A')].join(':');
 try{return await changeCached(db,`peers:${companyId}:${dateKey}`,['companies','company_relationships','company_fundamentals','eod_prices'],async()=>{
  for(const theme of COMPANY_THEMES){
   const graph=await loadThemeGraph(theme).catch(()=>{complete=false;return null;});if(!graph)continue;
   const group=peerGroup(companyId,graph.nodes);if(!group)continue;
   const financials=new Map<string,unknown>(),prices=new Map<string,Record<string,unknown>[]>(),today=marketDate(group.market);
   for(let i=0;i<group.companies.length;i+=100){
    const batch=group.companies.slice(i,i+100);
    const docs=await db.getAll(...batch.map(c=>db.collection('company_fundamentals').doc(group.market==='US'?c.id.slice(3):c.id)),{fieldMask:['value.metrics','value.report','value.marketCap','cnAnnual','marketCap']}).catch(()=>{complete=false;return [];});
    docs.forEach((doc,index)=>financials.set(batch[index].id,doc.data()));
   }
   // Bound concurrent reads while retaining every member of the published comparison group.
   for(let i=0;i<group.companies.length;i+=8)await Promise.all(group.companies.slice(i,i+8).map(async company=>{
    const ticker=group.market==='US'?company.id.slice(3):company.id,prefix=`${group.market}_${ticker}_`;
    const snapshot=await db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix).where(FieldPath.documentId(),'<=',prefix+today).orderBy(FieldPath.documentId(),'desc').limit(12).get().catch(()=>{complete=false;return null;});
    prices.set(company.id,snapshot?.docs.map(doc=>doc.data())??[]);
   }));
   return buildPeerComparison(companyId,graph.nodes,financials,prices,today);
  }
  return null;
 },()=>complete);}
 catch(error){console.error('Company peer comparison unavailable',error);return null;}
}
