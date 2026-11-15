import type {Firestore,DocumentReference} from 'firebase-admin/firestore';
import {Timestamp,getFirestore} from 'firebase-admin/firestore';
import {PriceStore,readHead,type Head} from './storage';
import {type Step} from './query';

export const parquetPrices=()=>process.env.PRICE_STORAGE==='parquet';
export const parquetReads=()=>parquetPrices()||process.env.PRICE_STORAGE==='parquet-read';
export const shadowPrices=()=>['shadow','parquet-read'].includes(process.env.PRICE_STORAGE??'');
export async function mirrorCommittedPrices(db:Firestore,ids:string[]){
 if(!shadowPrices()||!ids.length)return;
 const store=await priceStore();
 for(let i=0;i<ids.length;i+=500){
  const docs=await db.getAll(...ids.slice(i,i+500).map(id=>db.collection('eod_prices').doc(id)));
  await store.ingest(docs.filter(doc=>doc.exists).map(doc=>({id:doc.id,data:doc.data()!})));
 }
 console.info(JSON.stringify({event:'price_parquet_mirror',rows:ids.length}));
}

/** Temporary rollback copy. Only newly committed rows are touched; history is
 * never scanned. Timestamp guards prevent a delayed copy replacing newer data. */
export async function mirrorParquetPrices(rows:Array<{id:string;data:Record<string,unknown>}>,source?:Firestore){
 if(process.env.PRICE_FIRESTORE_MIRROR!=='1')return;
 const db=source??getFirestore();
 for(let offset=0;offset<rows.length;offset+=200){
  const page=rows.slice(offset,offset+200),refs=page.map(row=>db.collection('eod_prices').doc(row.id));
  await db.runTransaction(async tx=>{
   const previous=await tx.getAll(...refs);
   for(let i=0;i<page.length;i++){
    const stamp=page[i].data.updatedAt,old=previous[i].get('updatedAt');
    if(!(stamp instanceof Timestamp))throw Error('Missing price commit timestamp');
    if(old instanceof Timestamp&&old.valueOf()>stamp.valueOf())continue;
    tx.set(refs[i],page[i].data);
   }
  });
 }
 console.info(JSON.stringify({event:'price_firestore_rollback_copy',rows:rows.length}));
}

declare global {
 var __youAnalystParquetStore:Promise<PriceStore>|undefined;
 var __youAnalystPriceHead:{store:PriceStore;expires:number;promise:Promise<Head>}|undefined;
}
export function priceStore(){
 return globalThis.__youAnalystParquetStore??=import('../firebase/admin').then(({getAdminStorageBucket})=>{
  const name=process.env.ENTITY_SNAPSHOT_BUCKET||process.env.EODHD_BULK_EOD_BUCKET;
  if(!name)throw Error('Price bucket is not configured');
  return new PriceStore(getAdminStorageBucket(name));
 }).catch(error=>{globalThis.__youAnalystParquetStore=undefined;throw error;});
}
async function currentHead(store:PriceStore){
 const cachedHead=globalThis.__youAnalystPriceHead;
 if(!cachedHead||cachedHead.store!==store||cachedHead.expires<Date.now()){
  const entry={store,expires:Date.now()+1000,promise:readHead(store.bucket)};globalThis.__youAnalystPriceHead=entry;
  entry.promise.catch(()=>{if(globalThis.__youAnalystPriceHead===entry)globalThis.__youAnalystPriceHead=undefined;});
 }
 return globalThis.__youAnalystPriceHead!.promise;
}
export function invalidatePriceHead(){globalThis.__youAnalystPriceHead=undefined;}
export async function priceSnapshot(db:Firestore,steps:Step[],id?:string){
 const store=await priceStore(),head=await currentHead(store);
 if(!head.manifest.ready)throw Error('Parquet price migration is not ready');
 const rows=await store.query(id?[{method:'where',args:['id','==',id]}]:steps,head),readTime=Timestamp.now();
 const make=(key:string,data?:Record<string,unknown>)=>({id:key,exists:!!data,ref:db.collection('eod_prices').doc(key),readTime,
  updateTime:data?.updatedAt instanceof Timestamp?data.updatedAt:undefined,data:()=>data,get:(name:string)=>data?.[name]});
 if(id)return make(id,rows[0]?.data);
 const docs=rows.map(row=>make(row.id,row.data));
 return {docs,size:docs.length,empty:!docs.length,readTime,forEach:(callback:(doc:typeof docs[number])=>void)=>docs.forEach(callback)};
}
export async function priceDocuments(db:Firestore,refs:DocumentReference[]){
 const store=await priceStore(),readTime=Timestamp.now();
 const rows=await store.query([{method:'where',args:['id','in',refs.map(r=>r.id)]},{method:'limit',args:[1000]}],await currentHead(store));
 const byId=new Map(rows.map(row=>[row.id,row.data]));
 return refs.map(ref=>{const data=byId.get(ref.id);return {id:ref.id,ref,exists:!!data,readTime,updateTime:data?.updatedAt,
  data:()=>data,get:(name:string)=>data?.[name]};});
}
