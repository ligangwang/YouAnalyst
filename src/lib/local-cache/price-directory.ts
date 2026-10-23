import {FieldPath,Timestamp,type Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {loadEntitySqlite,type EntityRows} from '../entity-snapshots/sqlite';
import {partitionFor,pricePartition,type PricePartition} from '../entity-snapshots/price-partition';
import {EntitySync,type Subscribe} from './entity-sync';
import {withLiveCompanyReads} from './company-directory';
export type PriceStep={method:string;args:unknown[]};
type Plan={prefix:string;lower:string;upper:string;firstYear?:number;lastYear:number;descending:boolean;limit?:number};
export type PriceOptions={file?:(part:PricePartition)=>Promise<EntityRows|undefined>;years?:(prefix:string)=>Promise<number[]>;subscribe?:(part:PricePartition)=>Subscribe};
const name=(value:unknown)=>value==='__name__'||value instanceof FieldPath&&value.isEqual(FieldPath.documentId());
export function pricePlan(id:string|undefined,steps:PriceStep[]):Plan|undefined{
 if(id){const part=pricePartition(id);return part?{prefix:`${part.market}_${part.ticker}_`,lower:id,upper:id,firstYear:part.year,lastYear:part.year,descending:false}:undefined;}
 if(steps.some(s=>!['where','orderBy','limit','select'].includes(s.method)))return undefined;
 const filters=steps.filter(s=>s.method==='where');
 if(filters.length!==2||filters.some(s=>!name(s.args[0])||!['>=','<='].includes(String(s.args[1]))||typeof s.args[2]!=='string'))return undefined;
 const lower=filters.find(s=>s.args[1]==='>=')?.args[2] as string,upper=filters.find(s=>s.args[1]==='<=')?.args[2] as string;
 if(!lower||!upper)return undefined;
 const high=pricePartition(upper),low=pricePartition(lower);if(!high)return undefined;
 const prefix=`${high.market}_${high.ticker}_`;
 if(lower!==prefix&&(!low||low.market!==high.market||low.ticker!==high.ticker))return undefined;
 const orders=steps.filter(s=>s.method==='orderBy');if(orders.some(s=>!name(s.args[0])))return undefined;
 const limit=steps.find(s=>s.method==='limit')?.args[0];
 return {prefix,lower,upper,firstYear:low?.year,lastYear:high.year,descending:orders[0]?.args[1]==='desc',limit:typeof limit==='number'?limit:undefined};
}
type Entry={promise:Promise<EntityRows>;sync?:EntitySync;busy:number};
type Store={parts:Map<string,Entry>;years:Map<string,{expires:number;promise:Promise<number[]>}>};
declare global {var __pricePartitionsV1:WeakMap<Firestore,Store>|undefined;}
const stores=globalThis.__pricePartitionsV1??=new WeakMap<Firestore,Store>();
async function bucket():Promise<Bucket>{
 const name=process.env.ENTITY_SNAPSHOT_BUCKET?.trim()||process.env.EODHD_BULK_EOD_BUCKET?.trim();if(!name)throw Error('Price snapshot bucket missing');
 const {getAdminStorageBucket}=await import('../firebase/admin');return getAdminStorageBucket(name);
}
async function availableYears(prefix:string){
 const part=partitionFor(prefix,2000),folder=part.object.slice(0,part.object.lastIndexOf('/')+1);
 const [files]=await (await bucket()).getFiles({prefix:folder});
 return files.flatMap(file=>{const match=/\/(\d{4})\.sqlite$/.exec(file.name);return match?[Number(match[1])]:[];});
}
function subscribe(db:Firestore,part:PricePartition):Subscribe {
 return (since,next,error)=>db.collection('eod_prices')
  .where(FieldPath.documentId(),'>=',part.prefix).where(FieldPath.documentId(),'<=',part.prefix+'\uf8ff')
  .where('updatedAt','>=',since).orderBy('updatedAt').orderBy(FieldPath.documentId())
  .onSnapshot(snapshot=>next({readTime:snapshot.readTime,changes:snapshot.docChanges().map(change=>({id:change.doc.id,data:change.type==='removed'?{isDeleted:true,updatedAt:snapshot.readTime}:change.doc.data()}))}),error);
}
async function partition(db:Firestore,store:Store,part:PricePartition,options:PriceOptions){
 let entry=store.parts.get(part.object);
 if(!entry){
  entry={busy:0,promise:undefined as unknown as Promise<EntityRows>};const current=entry;
  current.promise=(async()=>{
   let rows=await(options.file?options.file(part):loadEntitySqlite(await bucket(),'cold',undefined,'eod_prices',part.object));
   if(!rows){
    // Missing/new partitions fall back only to this ticker/year, never the collection.
    const snapshot=await withLiveCompanyReads(()=>db.collection('eod_prices').where(FieldPath.documentId(),'>=',part.prefix).where(FieldPath.documentId(),'<=',part.prefix+'\uf8ff').get());
    rows=new Map(snapshot.docs.map(doc=>[doc.id,doc.data()]));rows.watermark=snapshot.readTime;
   }
   if(!rows.watermark)throw Error('Price snapshot watermark missing');
   const result:EntityRows=new Map(rows);
   current.sync=new EntitySync(options.subscribe?options.subscribe(part):subscribe(db,part),rows.watermark,changes=>{
    for(const change of changes){
     const before=result.get(change.id)?.updatedAt,after=change.data.updatedAt;
     if(before instanceof Timestamp&&after instanceof Timestamp&&(before.seconds>after.seconds||before.seconds===after.seconds&&before.nanoseconds>after.nanoseconds))continue;
     result.set(change.id,change.data);
    }
   });
   await current.sync.ready();return result;
  })().catch(error=>{current.sync?.close();store.parts.delete(part.object);throw error;});
  store.parts.set(part.object,current);
 }
 entry.busy++;store.parts.delete(part.object);store.parts.set(part.object,entry);
 try{const rows=await entry.promise;await entry.sync?.ready();return rows;}
 finally{entry.busy--;for(const [key,value] of store.parts){if(store.parts.size<=128)break;if(!value.busy){value.sync?.close();store.parts.delete(key);}}}
}
/** Only recognized single-ticker queries use snapshots; broad maintenance scans stay live. */
export async function priceRows(db:Firestore,plan:Plan,options:PriceOptions={}):Promise<EntityRows>{
 let store=stores.get(db);if(!store){store={parts:new Map(),years:new Map()};stores.set(db,store);}
 let years:number[];
 if(plan.firstYear!==undefined){years=[];for(let year=plan.firstYear;year<=plan.lastYear;year++)years.push(year);}
 else{
  let listing=store.years.get(plan.prefix);
  if(!listing||listing.expires<Date.now()){
   const promise=(options.years??availableYears)(plan.prefix).catch(error=>{store!.years.delete(plan.prefix);throw error;});
   listing={expires:Date.now()+86400000,promise};store.years.set(plan.prefix,listing);
   if(store.years.size>1024)store.years.delete(store.years.keys().next().value!);
  }
  // Probe the requested year's partition even before its first daily publication.
  years=[...new Set([...(await listing.promise),plan.lastYear])].filter(year=>year<=plan.lastYear);
 }
 years.sort((a,b)=>plan.descending?b-a:a-b);const result:EntityRows=new Map();
 for(const year of years){
  const rows=await partition(db,store,partitionFor(plan.prefix,year),options);
  for(const [id,data] of rows)if(id>=plan.lower&&id<=plan.upper&&data.isDeleted!==true)result.set(id,data);
  if(plan.limit!==undefined&&result.size>=plan.limit)break;
 }
 return result;
}
