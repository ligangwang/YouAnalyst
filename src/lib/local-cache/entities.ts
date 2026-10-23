import { FieldPath, type Firestore, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';
import type { ExchangeRegion } from '../market-companies/exchange-region';
import type { Collection, RelationshipQuery } from '../central-cache/store';
import { Watch, track } from './watch';
import { dataBytes } from './read-scope';
import {companyDirectoryEnabled,companyDirectoryVersion,enableCompanyDirectoryForReader} from './company-directory';
import { themeIdBatches } from '../company-themes/company-query';

type Group={users:number;ids:string[];bytes:number; watch:Watch<Map<string,DocumentSnapshot>>};
type DocumentStore={documents:Map<string,Group>;groups:Set<Group>};
type Store={versions:Map<string,number>;queries:Map<string,Watch<Map<string,DocumentSnapshot>>>; queryUsers?:Map<string,number>; documentStores:Map<Collection,DocumentStore>};
// Next server bundles can evaluate this module more than once in one process.
declare global { var __youAnalystEntityStoresV2: WeakMap<Firestore,Store> | undefined; }
const stores=globalThis.__youAnalystEntityStoresV2 ??= new WeakMap<Firestore,Store>();
function store(db:Firestore){let value=stores.get(db);if(!value){value={versions:new Map(),queries:new Map(),documentStores:new Map()};stores.set(db,value);}return value;}
function watchQuery(query:Query,changed:(docs:DocumentSnapshot[])=>void){return track(new Watch<Map<string,DocumentSnapshot>>((next,error)=>query.onSnapshot(snapshot=>{
  // Firestore broadcasts a list of added/modified/removed document IDs to every
  // instance. Its snapshot includes the new values; no getAll refresh is needed.
  changed(snapshot.docs);next(new Map(snapshot.docs.map(doc=>[doc.id,doc])));
},error)));}
export async function localQuery(db:Firestore,key:string,query:Query,collection:string='companies'){
 if(companyDirectoryEnabled(db))return new Map((await query.get()).docs.map(doc=>[doc.id,doc]));
 const s=store(db);let watch=s.queries.get(key);
 if(!watch){
  watch=watchQuery(query,()=>s.versions.set(collection,(s.versions.get(collection)??0)+1));
  const created=watch,close=created.close.bind(created);
  created.close=()=>{if(s.queries.get(key)===created)s.queries.delete(key);close();};
  s.queries.set(key,watch);
 }
 const users=s.queryUsers??=new Map();users.set(key,(users.get(key)??0)+1);
 try{return await watch.read();}finally{const count=(users.get(key)??1)-1;if(count)users.set(key,count);else users.delete(key);}
}

async function documents(db:Firestore,collection:Collection,ids:string[]){
 const entityStore=store(db);
 let s=entityStore.documentStores.get(collection);
 if(!s){s={documents:new Map(),groups:new Set()};entityStore.documentStores.set(collection,s);}
 const cache=s;
 // One-company requests create one group each. Keep fundamentals independently
 // of company traffic, with both ID and estimated payload limits for larger batches.
 const maxGroups=256;
 const maxBytes=16*1024*1024, maxDocuments=960;
 const evict=()=>{
  let bytes=[...cache.groups].reduce((sum,group)=>sum+group.bytes,0);
  for(const group of cache.groups){
   if(cache.groups.size<=maxGroups&&cache.documents.size<=maxDocuments&&bytes<=maxBytes)break;
   if(group.users)continue;
   bytes-=group.bytes;group.watch.close();
  }
 };
 const missing=[...new Set(ids)].filter(id=>!cache.documents.has(`${collection}/${id}`));
 for(let i=0;i<missing.length;i+=30){
  const batch=missing.slice(i,i+30);
  const group:Group={users:0,ids:batch.map(id=>`${collection}/${id}`),bytes:0,watch:undefined as unknown as Group['watch']};
  group.watch=watchQuery(db.collection(collection).where(FieldPath.documentId(),'in',batch),docs=>{
   entityStore.versions.set(collection,(entityStore.versions.get(collection)??0)+1);
   group.bytes=docs.reduce((sum,doc)=>sum+dataBytes(doc.data(),maxBytes),0);
   queueMicrotask(evict);
  });
  const close=group.watch.close.bind(group.watch);
  group.watch.close=()=>{
   cache.groups.delete(group);
   for(const key of group.ids)if(cache.documents.get(key)===group)cache.documents.delete(key);
   close();
  };
  cache.groups.add(group);for(const key of group.ids)cache.documents.set(key,group);
 }
 const groups=new Set(ids.map(id=>s.documents.get(`${collection}/${id}`)!));
 // Pin this request's groups until their first snapshot arrives. Capacity eviction
 // closes idle subscriptions; it is not periodic expiry or request-time polling.
 for(const group of groups){group.users++;s.groups.delete(group);s.groups.add(group);}
 try {
 const values=await Promise.all([...groups].map(group=>group.watch.read()));
 const found=new Map(values.flatMap(value=>[...value]).filter(([,doc])=>doc.data()?.isDeleted!==true));
 return ids.map(id=>found.get(id)??({id,exists:false,ref:db.collection(collection).doc(id),data:()=>undefined,get:()=>undefined} as unknown as DocumentSnapshot));
 } finally {
  for(const group of groups)group.users--;
  evict();
 }
}
/** Undefined is reserved for non-listening test adapters, never network failures. */
export async function localDocuments(db:Firestore,collection:Collection,ids?:string[],query?:RelationshipQuery,_projection?:'marketCap',region?:ExchangeRegion):Promise<DocumentSnapshot[]|undefined>{
 enableCompanyDirectoryForReader(db);
 if(ids&&companyDirectoryEnabled(db))return ids.length?db.getAll(...ids.map(id=>db.collection(collection).doc(id))):[];
 if(typeof db.collection(collection).onSnapshot!=='function')return undefined;
 if(ids)return documents(db,collection,ids);
 if(collection==='companies'){
  const batches=await themeIdBatches(db),keys=new Set(batches.map(ids=>`companies:themes:${ids.join(',')}`));
  // Catalog edits replace subscriptions; never close an active initial read.
  const cached=store(db);
  for(const [key,watch] of cached.queries)if(key.startsWith('companies:themes:')&&!keys.has(key)&&!cached.queryUsers?.get(key))watch.close();
  const found=new Map<string,DocumentSnapshot>();
  for(const ids of batches){
   const query=db.collection(collection).where('themeIds','array-contains-any',ids);
   const docs=await localQuery(db,`companies:themes:${ids.join(',')}`,query,collection);
   for(const [id,doc] of docs)if(doc.data()?.isDeleted!==true)found.set(id,doc);
  }
  return [...found.values()].filter(doc=>!region || (typeof doc.get==='function'?doc.get('exchange_region'):doc.data()?.exchange_region)===region);
 }
 const source=db.collection(collection);
 if(collection==='company_fundamentals')throw Error('Fundamentals cache requires company IDs');
 let selected:DocumentSnapshot[];
 if(collection==='company_relationships'&&companyDirectoryEnabled(db)&&query&&(query.companyIds||query.exactIds)){
  const found=new Map<string,DocumentSnapshot>();
  for(const field of ['source','target'])for(let start=0;start<(query.companyIds?.length??0);start+=30){
   const page=await source.where(field,'in',query.companyIds!.slice(start,start+30)).get();
   for(const doc of page.docs)found.set(doc.id,doc);
  }
  if(query.exactIds?.length)for(const doc of await db.getAll(...query.exactIds.map(id=>db.collection(collection).doc(id))))if(doc.exists)found.set(doc.id,doc);
  selected=[...found.values()];
 }else selected=[...(await localQuery(db,collection,source,collection)).values()];
 let rows=selected.filter(doc=>(typeof doc.get==='function'?doc.get('isDeleted'):doc.data()?.isDeleted)!==true);
 if(region)rows=rows.filter(doc=>doc.get('exchange_region')===region);
 if(query){
  if(query.status)rows=rows.filter(doc=>doc.get('status')===query.status);
  if(query.theme)rows=rows.filter(doc=>(doc.get('themeIds')??[]).includes(query.theme));
  if(query.companyIds||query.exactIds){const companies=new Set(query.companyIds),exact=new Set(query.exactIds);rows=rows.filter(doc=>exact.has(doc.id)||companies.has(doc.get('source'))||companies.has(doc.get('target')));}
  if(query.prefix!==undefined){const lower=Buffer.from(query.prefix),upper=Buffer.from(query.prefix+'\uf8ff');rows=rows.filter(doc=>Buffer.compare(Buffer.from(doc.id),lower)>=0&&Buffer.compare(Buffer.from(doc.id),upper)<0).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(0,query.limit??100);}
 }
 return rows;
}

export function localEntityVersions(db:Firestore){const s=store(db);return Object.fromEntries(['companies','company_fundamentals','company_relationships'].map(name=>[name,companyDirectoryEnabled(db)?companyDirectoryVersion(db,name as import('../entity-snapshots/sync').Collection):`local:${s.versions.get(name)??0}`]));}
