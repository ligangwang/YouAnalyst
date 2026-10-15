import { FieldPath } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { loadThemeGraph } from '../company-themes/graph-service';
import { COMPANY_THEMES } from '../company-themes/model';
import { marketDate } from '../predictions/instrument';
import { buildPeerComparison, peerGroup, type PeerComparison } from './model';

const cached=new Map<string,{expires:number;value:PeerComparison|null}>();
const pending=new Map<string,Promise<PeerComparison|null>>();
/** Read existing caches only. Comparison views never enqueue provider requests or create collections. */
export async function loadPeerComparison(companyId:string):Promise<PeerComparison|null>{
 if(!/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId))return null;
 const hit=cached.get(companyId);if(hit&&hit.expires>Date.now())return hit.value;
 const request=pending.get(companyId);if(request)return request;
 const promise=(async()=>{
  const db=getAdminFirestore();
  for(const theme of COMPANY_THEMES){
   const graph=await loadThemeGraph(theme).catch(()=>null);if(!graph)continue;
   const group=peerGroup(companyId,graph.nodes);if(!group)continue;
   const financials=new Map<string,unknown>(),prices=new Map<string,Record<string,unknown>[]>(),today=marketDate(group.market);
   for(let i=0;i<group.companies.length;i+=100){
    const batch=group.companies.slice(i,i+100);
    const docs=await db.getAll(...batch.map(c=>db.collection('company_fundamentals').doc(group.market==='US'?c.id.slice(3):c.id)),{fieldMask:['value.metrics','value.report','value.marketCap','cnAnnual','marketCap']}).catch(()=>[]);
    docs.forEach((doc,index)=>financials.set(batch[index].id,doc.data()));
   }
   // Bound concurrent reads while retaining every member of the published comparison group.
   for(let i=0;i<group.companies.length;i+=8)await Promise.all(group.companies.slice(i,i+8).map(async company=>{
    const ticker=group.market==='US'?company.id.slice(3):company.id,prefix=`${group.market}_${ticker}_`;
    const snapshot=await db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix).where(FieldPath.documentId(),'<=',prefix+today).orderBy(FieldPath.documentId(),'desc').limit(12).get().catch(()=>null);
    prices.set(company.id,snapshot?.docs.map(doc=>doc.data())??[]);
   }));
   return buildPeerComparison(companyId,graph.nodes,financials,prices,today);
  }
  return null;
 })();
 pending.set(companyId,promise);
 try{const value=await promise;cached.set(companyId,{value,expires:Date.now()+60000});if(cached.size>500)cached.delete(cached.keys().next().value!);return value;}
 catch(error){console.error('Company peer comparison unavailable',error);return null;}
 finally{pending.delete(companyId);}
}
