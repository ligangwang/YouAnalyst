import type {DocumentSnapshot, Firestore} from 'firebase-admin/firestore';

export const MARKET_CAP_BATCH_SIZE = 1000;
type Request = {ids:string[];resolve:(docs:DocumentSnapshot[])=>void;reject:(error:unknown)=>void};
declare global {var __marketCapBatchesV1:WeakMap<Firestore,Request[]>|undefined;}
const pending=globalThis.__marketCapBatchesV1??=new WeakMap<Firestore,Request[]>();

/** Combine concurrent US/CN callers. References, never a collection scan.
 * The field mask also bypasses the observer's file/listener read interception. */
export function readMarketCapBatch(db:Firestore,ids:string[]):Promise<DocumentSnapshot[]> {
  if(!ids.length)return Promise.resolve([]);
  return new Promise((resolve,reject)=>{
    const existing=pending.get(db);
    const requests=existing??[];
    requests.push({ids,resolve,reject});
    if(existing)return;
    pending.set(db,requests);
    queueMicrotask(()=>{
      pending.delete(db);
      const read=async(ids:string[])=>{
        const unique=[...new Set(ids)];
        const found=new Map<string,DocumentSnapshot>();
        for(let start=0;start<unique.length;start+=MARKET_CAP_BATCH_SIZE){
          const refs=unique.slice(start,start+MARKET_CAP_BATCH_SIZE).map(id=>db.collection('company_fundamentals').doc(id));
          const docs=await db.getAll(...refs,{fieldMask:['marketCap','isDeleted']});
          for(const doc of docs)found.set(doc.id,doc);
        }
        return found;
      };
      void read(requests.flatMap(request=>request.ids)).then(found=>{
        for(const request of requests)request.resolve(request.ids.map(id=>found.get(id)!));
      },async error=>{
        if(requests.length===1){requests[0].reject(error);return;}
        // A failed combined read must not suppress an independent region.
        // Retry bounded original groups only on failure, never on a warm read.
        for(const request of requests)try{
          const found=await read(request.ids);request.resolve(request.ids.map(id=>found.get(id)!));
        }catch(reason){request.reject(reason);}
      });
    });
  });
}
