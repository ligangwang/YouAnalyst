import {setImmediate as yieldToRequests} from 'node:timers/promises';
import {COMPANY_VIEW_OBJECT,companyViewData,isCompanyViewField} from '../entity-snapshots/company-view';
import {pricePlan,priceRows,refreshPriceIds,type PriceOptions} from './price-directory';
import {syncEntityChanges,type EntitySync,type EntityChange} from './entity-sync';
import {collections,type Collection} from '../entity-snapshots/sync';
export const isSnapshotCollection=(name:string):name is Collection=>(collections as readonly string[]).includes(name);
import {AsyncLocalStorage} from 'node:async_hooks';
import {FieldPath, Timestamp, type Firestore, type DocumentData} from 'firebase-admin/firestore';
import {isDeepStrictEqual} from 'node:util';
import {gzipSync,gunzipSync} from 'node:zlib';
import {snapshotFiles} from '../entity-snapshots/storage';
import {loadEntitySqlite,inheritEntitySqliteIndex,type EntityRows} from '../entity-snapshots/sqlite';

type Step={method:string;args:unknown[]};
type Source={id?:string;steps:Step[];collection:Collection};
type Rows=EntityRows;
type Entry={view?:boolean;rows?:Rows;expires:number;pending?:Promise<Rows>;version:number;overrides:Rows;sync?:EntitySync};
type Options={price?:PriceOptions;sync?:typeof syncEntityChanges|false;file?:(collection:Collection,view?:boolean)=>Promise<Rows|undefined>;now?:()=>number};
declare global {
 var __companyViewReadsV1:AsyncLocalStorage<boolean>|undefined;
 var __companySearchReadsV1:AsyncLocalStorage<boolean>|undefined;
 var __companyPageReadsV1:AsyncLocalStorage<boolean>|undefined;
 var __companyDirectoryV2:{entries:WeakMap<Firestore,Map<string,Entry>>;sources:WeakMap<object,Source>;clients:WeakMap<Firestore,{raw:Firestore;options:Options}>;live:AsyncLocalStorage<boolean>}|undefined;
}
const state=globalThis.__companyDirectoryV2??={entries:new WeakMap(),sources:new WeakMap(),clients:new WeakMap(),live:new AsyncLocalStorage()};
const pageReads=globalThis.__companyPageReadsV1??=new AsyncLocalStorage<boolean>();
const searchReads=globalThis.__companySearchReadsV1??=new AsyncLocalStorage<boolean>();
/** Autocomplete must not hydrate whole company or instrument snapshots. */
export const withSearchEntityReads=<T>(work:()=>Promise<T>):Promise<T>=>searchReads.run(true,work);
/** A company request uses the existing targeted push caches, not whole files. */
export const withPageEntityReads=<T>(work:()=>Promise<T>):Promise<T>=>pageReads.run(true,work);
/** A page's broad company selectors still belong to the shared directory.
 * Explicit authoritative reads remain live through the independent live scope. */
export const withSharedCompanyQuery=<T>(work:()=>Promise<T>):Promise<T>=>pageReads.run(false,work);
const viewReads=globalThis.__companyViewReadsV1??=new AsyncLocalStorage<boolean>();
export const withCompanyViewQuery=<T>(work:()=>Promise<T>):Promise<T>=>viewReads.run(true,work);
const DAY=86_400_000;
/** Maintenance and transactional decisions must read authoritative data. */
export const withLiveCompanyReads=<T>(work:()=>T):T=>state.live.run(true,work);
export const liveCompanyReads=()=>state.live.getStore()===true;
export function enableCompanyDirectory(db:Firestore,raw:Firestore,options:Options={}){if(!state.clients.has(db))state.clients.set(db,{raw,options});}
/** Collector/graph readers use the same directory; unwrapped test adapters are unchanged. */
export function enableCompanyDirectoryForReader(db:Firestore){if(typeof db.settings==='function'&&typeof db.getAll==='function'&&state.sources.has(db.collection('companies')))enableCompanyDirectory(db,db);}
export function companyDirectoryEnabled(db:Firestore,collection:Collection='companies'){
 return state.clients.has(db)&&!state.live.getStore()
  &&!(pageReads.getStore()&&['companies','company_fundamentals','company_relationships'].includes(collection))
  &&!(searchReads.getStore()&&['companies','instruments'].includes(collection));
}
export function registerCompanySource(source:object,id:string|undefined,steps:Step[],collection:Collection='companies'){state.sources.set(source,{id,steps,collection});}
export function companyDirectoryVersion(db:Firestore,collection:Collection='companies'){
 return [collection,...(collection==='companies'?['companies:view']:[])].map(key=>{const entry=state.entries.get(db)?.get(key);return `${entry?.version??0}:${entry&&Date.now()>=entry.expires?'expired':'current'}`;}).join('|');
}
/** Read after a local committed write, never after an ordinary page request. */
export async function refreshCompanyDirectoryIds(db:Firestore,ids:string[],collection:Collection='companies'){
 const client=state.clients.get(db);if(!client||!ids.length)return;
 if(collection==='eod_prices')return refreshPriceIds(client.raw,ids);
 const entries=[collection,...(collection==='companies'?['companies:view']:[])].flatMap(key=>{const entry=state.entries.get(db)?.get(key);return entry?[entry]:[];});if(!entries.length)return;
 const docs=await withLiveCompanyReads(()=>client.raw.getAll(...[...new Set(ids)].map(id=>client.raw.collection(collection).doc(id))));
 for(const entry of entries)applyChanges(entry,docs.map(doc=>({id:doc.id,data:doc.exists?doc.data()!:{isDeleted:true}})));

}

function applyChanges(entry:Entry,changes:EntityChange[]){
 const changed:string[]=[];
 for(const {id,data} of changes){
  const previous=entry.overrides.get(id)??entry.rows?.get(id);
  if(previous?.updatedAt instanceof Timestamp&&data.updatedAt instanceof Timestamp&&compare(previous.updatedAt,data.updatedAt)>0)continue;
  entry.overrides.set(id,entry.view?companyViewData(data):compact(data));changed.push(id);
 }
 if(entry.rows&&changed.length){entry.rows=inheritEntitySqliteIndex(entry.rows,new Map([...entry.rows,...entry.overrides]),changed);entry.version++;}
}

async function fileRows(reason:'cold'|'refresh',collection:Collection,view=false):Promise<Rows|undefined>{
 const bucket=process.env.ENTITY_SNAPSHOT_BUCKET?.trim()||process.env.EODHD_BULK_EOD_BUCKET?.trim();
 if(!bucket)return undefined;
 const {getAdminStorageBucket}=await import('../firebase/admin');
 const storage=getAdminStorageBucket(bucket);
 if(view){const rows=await loadEntitySqlite(storage,reason,undefined,'companies',COMPANY_VIEW_OBJECT);if(rows)return rows;}
 const sqlite=await loadEntitySqlite(storage,reason,undefined,collection);if(sqlite)return sqlite;
 // Rolling compatibility until the daily job publishes its first SQLite file.
 const result=await snapshotFiles(storage).load(collection,row=>({id:row.id,data:compact(row.data)}),{reason});
 if(!result.snapshot)return undefined;
 const rows:Rows=new Map(result.snapshot.rows.map(row=>[row.id,row.data]));rows.watermark=result.snapshot.watermark;return rows;
}
// Prefix arrays dominate the directory size. Retain them losslessly compressed;
// ordinary company/graph/sitemap reads never need to expand this search index.
function compact(data:DocumentData):DocumentData {
 if(Object.getOwnPropertyDescriptor(data,'searchPrefixes')?.get)return data;
 if(Array.isArray(data.searchPrefixes)&&data.searchPrefixes.length>100){
  const bytes=gzipSync(JSON.stringify(data.searchPrefixes));
  delete data.searchPrefixes;
  Object.defineProperty(data,'searchPrefixes',{enumerable:true,get:()=>JSON.parse(gunzipSync(bytes).toString())});
 }
 return data;
}
export async function companyDirectory(db:Firestore,collection:Collection='companies',view=false):Promise<Rows>{
 if(view&&collection!=='companies')throw Error('Company view requires companies');
 if(collection==='eod_prices')throw Error('Prices require a ticker/year query');
 const client=state.clients.get(db);if(!client)throw Error('Company directory is not enabled');
 const now=client.options.now??Date.now;
 let partition=state.entries.get(db);if(!partition){partition=new Map();state.entries.set(db,partition);}
 const key=view?'companies:view':collection;
 let entry=partition.get(key);if(!entry){entry={view,expires:0,version:0,overrides:new Map()};partition.set(key,entry);}
 if(entry.rows&&now()<entry.expires)return entry.rows;
 const current=entry;
 if(!current.pending)current.pending=Promise.resolve().then(async()=>{
   let rows=await(client.options.file?client.options.file(collection,view):fileRows(current.rows?'refresh':'cold',collection,view));
   // An empty snapshot is valid. Only an absent file triggers Firestore.
   if(!rows){
    rows=new Map();let cursor:string|undefined;
    const base=client.raw.collection(collection).orderBy(FieldPath.documentId());
    for(;;){const page=await withLiveCompanyReads(()=>(cursor?base.startAfter(cursor):base).limit(500).get());
     rows.watermark??=page.readTime;
     for(const doc of page.docs)rows.set(doc.id,view?companyViewData(doc.data()):compact(doc.data()));
     if(page.size<500)break;cursor=page.docs.at(-1)!.id;
    }
   }
   // Attaching the inclusive query returns every change since the file boundary
   // in its initial snapshot, then keeps delivering updates without a handoff gap.
   if(!current.sync&&rows.watermark&&client.options.sync!==false)current.sync=(client.options.sync??syncEntityChanges)(client.raw,collection,rows.watermark,changes=>applyChanges(current,changes));
   if(current.sync)await current.sync.ready();
   for(const [id,data] of current.overrides){
    const incoming=rows.get(id)?.updatedAt,local=data.updatedAt;
    if(incoming instanceof Timestamp&&local instanceof Timestamp&&compare(incoming,local)>=0)current.overrides.delete(id);

   }
   if(current.overrides.size)rows=inheritEntitySqliteIndex(rows,new Map([...rows,...current.overrides]),current.overrides.keys());
   current.rows=rows;current.expires=now()+DAY;current.version++;return rows;
 }).catch(error=>{
   if(!current.rows)throw error;
   console.warn('Company snapshot refresh failed; retaining last successful directory');
   current.expires=now()+60_000;return current.rows;
 }).finally(()=>{current.pending=undefined;});
 return current.pending;
}

function fieldName(value:unknown):string {
 if(value instanceof FieldPath){if(value.isEqual(FieldPath.documentId()))return '__name__';throw Error('Company cache requires string field paths');}
 if(typeof value!=='string')throw Error('Unsupported company cache field');return value;
}
const field=(data:DocumentData,name:string):unknown=>name.split('.').reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as DocumentData)[key]:undefined,data);
function compare(a:unknown,b:unknown):number {
 if(isDeepStrictEqual(a,b))return 0;
 if(a instanceof Timestamp&&b instanceof Timestamp)return a.seconds-b.seconds||a.nanoseconds-b.nanoseconds;
 if(typeof a==='string'&&typeof b==='string')return Buffer.compare(Buffer.from(a),Buffer.from(b));
 if(typeof a==='number'&&typeof b==='number')return a-b;
 if(typeof a==='boolean'&&typeof b==='boolean')return Number(a)-Number(b);
 if(a===null)return -1;if(b===null)return 1;
 throw Error('Unsupported company cache comparison');
}
function matches(actual:unknown,op:unknown,wanted:unknown):boolean {
 if(actual===undefined)return false;
 switch(op){
  case '==':return isDeepStrictEqual(actual,wanted);
  case '!=':return wanted!==null&&!isDeepStrictEqual(actual,wanted);
  case 'in':return (wanted as unknown[]).some(v=>isDeepStrictEqual(actual,v));
  case 'not-in':return actual!==null&&!(wanted as unknown[]).includes(null)&&!(wanted as unknown[]).some(v=>isDeepStrictEqual(actual,v));
  case 'array-contains':return Array.isArray(actual)&&actual.some(v=>isDeepStrictEqual(v,wanted));
  case 'array-contains-any':return Array.isArray(actual)&&(wanted as unknown[]).some(v=>actual.some(a=>isDeepStrictEqual(a,v)));
  case '>':return typeof actual===typeof wanted&&compare(actual,wanted)>0;
  case '>=':return typeof actual===typeof wanted&&compare(actual,wanted)>=0;
  case '<':return typeof actual===typeof wanted&&compare(actual,wanted)<0;
  case '<=':return typeof actual===typeof wanted&&compare(actual,wanted)<=0;
  default:throw Error(`Unsupported company filter: ${String(op)}`);
 }
}
// Snapshot data is copied on access so consumers cannot mutate shared memory.
function document(db:Firestore,id:string,data:DocumentData|undefined,collection:Collection){
 const copy=(value:unknown):unknown=>{
  if(value instanceof Timestamp)return value;
  if(Buffer.isBuffer(value))return Buffer.from(value);
  if(value instanceof Date)return new Date(value);
  if(Array.isArray(value))return value.map(copy);
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)]));
  return value;
 };
 return {id,exists:data!==undefined,ref:db.collection(collection).doc(id),data:()=>copy(data),get:(name:string)=>copy(data?field(data,name):undefined)};
}
export function companySourceSnapshot(db:Firestore,source:object):Promise<unknown>|undefined {
 const spec=state.sources.get(source);if(!spec||!companyDirectoryEnabled(db,spec.collection))return undefined;
 // Enable only after legacy price writers drain, timestamps are migrated, and a snapshot is published.
 if(spec.collection==='eod_prices'&&process.env.PRICE_SNAPSHOT_READY!=='1')return undefined;
 const plan=spec.collection==='eod_prices'?pricePlan(spec.id,spec.steps):undefined;
 if(spec.collection==='eod_prices'&&!plan)return undefined;
 // Only explicitly projected, search-independent queries may use the smaller file.
 const projection=spec.steps.find(step=>step.method==='select');
 const view=spec.collection==='companies'&&viewReads.getStore()===true&&spec.id===undefined&&!!projection
  &&projection.args.every(arg=>isCompanyViewField(fieldName(arg)))
  &&spec.steps.filter(step=>['where','orderBy'].includes(step.method)).every(step=>isCompanyViewField(fieldName(step.args[0])));
 // Small peer comparisons share the same file + watermark delta path as charts.
 return (plan?priceRows(state.clients.get(db)!.raw,plan,state.clients.get(db)!.options.price):companyDirectory(db,spec.collection,view)).then(async rows=>{
  if(spec.id!==undefined){const data=rows.get(spec.id);return document(db,spec.id,data?.isDeleted===true?undefined:data,spec.collection);}
  const filters=spec.steps.filter(s=>s.method==='where');
  let candidates:Set<string>|undefined;
  for(const step of filters){
   const indexed=rows.candidateIds?.(fieldName(step.args[0]),String(step.args[1]),step.args[2]);
   if(indexed)candidates=candidates?new Set([...candidates].filter(id=>indexed.has(id))):indexed;
  }
  const value=(row:[string,DocumentData],name:string)=>name==='__name__'?row[0]:field(row[1],name);
  const order=spec.steps.filter(s=>s.method==='orderBy').map(s=>({name:fieldName(s.args[0]),direction:s.args[1]==='desc'?-1:1}));
  // Firestore implicitly orders inequality fields, then document ID.
  for(const name of [...new Set(filters.filter(s=>['<','<=','>','>=','!=','not-in'].includes(String(s.args[1]))).map(s=>fieldName(s.args[0])))].sort())
   if(!order.some(o=>o.name===name))order.push({name,direction:order.at(-1)?.direction??1});
  if(!order.some(o=>o.name==='__name__'))order.push({name:'__name__',direction:order.at(-1)?.direction??1});
  // Keep this immutable generation across yields; a committed update publishes
  // a replacement map. Decode/filter/order keys in bounded batches, including
  // rejected rows, so a cold full-snapshot scan cannot monopolize the event loop.
  const sourceRows=candidates?function*(){for(const id of candidates){const data=rows.get(id);if(data)yield [id,data] as [string,DocumentData];}}():rows;
  let result:[string,DocumentData][]=[];let scanned=0;
  for(const row of sourceRows){
   if(scanned++&&scanned%128===0)await yieldToRequests();
   if(rows.isDeleted?rows.isDeleted(row[0]):row[1].isDeleted===true)continue;
   if(!filters.every(step=>matches(value(row,fieldName(step.args[0])),step.args[1],step.args[2])))continue;
   if(order.every(o=>value(row,o.name)!==undefined))result.push(row);
  }
  result.sort((a,b)=>{for(const o of order){const c=compare(value(a,o.name),value(b,o.name))*o.direction;if(c)return c;}return 0;});
  for(const step of spec.steps.filter(s=>['startAt','startAfter','endAt','endBefore'].includes(s.method))){
   const first=step.args[0] as {id?:string;get?:(name:string)=>unknown}|undefined;
   const cursor=first?.get?order.map(o=>o.name==='__name__'?first.id:first.get!(o.name)):step.args;
   result=result.filter(row=>{let c=0;for(let i=0;i<cursor.length;i++){c=compare(value(row,order[i].name),cursor[i])*order[i].direction;if(c)break;}
    return step.method==='startAt'?c>=0:step.method==='startAfter'?c>0:step.method==='endAt'?c<=0:c<0;});
  }
  const offset=spec.steps.find(s=>s.method==='offset');if(offset)result=result.slice(Number(offset.args[0]));
  const limit=spec.steps.find(s=>s.method==='limit'||s.method==='limitToLast');if(limit)result=limit.method==='limit'?result.slice(0,Number(limit.args[0])):result.slice(-Number(limit.args[0]));
  const projection=spec.steps.find(s=>s.method==='select');
  const docs:ReturnType<typeof document>[]=[];
  for(let i=0;i<result.length;i++){
   if(i&&i%128===0)await yieldToRequests();
   const id=result[i][0];let data=result[i][1];
   if(projection){const selected:DocumentData={};for(const f of projection.args){const name=fieldName(f),v=field(data,name);if(v!==undefined){const parts=name.split('.');let into=selected;for(const part of parts.slice(0,-1))into=into[part]??={};into[parts.at(-1)!]=v;}}data=selected;}
   docs.push(document(db,id,data,spec.collection));
  }
  for(const step of spec.steps)if(!['where','orderBy','startAt','startAfter','endAt','endBefore','limit','limitToLast','offset','select'].includes(step.method))throw Error(`Unsupported cached company query: ${step.method}`);
  return {docs,size:docs.length,empty:docs.length===0,forEach:(fn:(doc:typeof docs[number])=>void,thisArg?:unknown)=>docs.forEach(doc=>fn.call(thisArg,doc))};
 });
}
