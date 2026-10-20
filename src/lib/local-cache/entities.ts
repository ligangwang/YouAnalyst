import { FieldPath, type Firestore, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';
import type { ExchangeRegion } from '../market-companies/exchange-region';
import type { Collection, RelationshipQuery } from '../central-cache/store';
import { Watch, track } from './watch';

type Group={users:number;ids:string[]; watch:Watch<Map<string,DocumentSnapshot>>};
type Store={versions:Map<string,number>;queries:Map<string,Watch<Map<string,DocumentSnapshot>>>; documents:Map<string,Group>; groups:Set<Group>};
const stores=new WeakMap<Firestore,Store>();
function store(db:Firestore){let value=stores.get(db);if(!value){value={versions:new Map(),queries:new Map(),documents:new Map(),groups:new Set()};stores.set(db,value);}return value;}
function watchQuery(query:Query,changed:()=>void){return track(new Watch<Map<string,DocumentSnapshot>>((next,error)=>query.onSnapshot(snapshot=>{
  // Firestore broadcasts a list of added/modified/removed document IDs to every
  // instance. Its snapshot includes the new values; no getAll refresh is needed.
  changed();next(new Map(snapshot.docs.map(doc=>[doc.id,doc])));
},error)));}
export async function localQuery(db:Firestore,key:string,query:Query,collection:string='companies'){
 const s=store(db);let watch=s.queries.get(key);
 if(!watch){watch=watchQuery(query,()=>s.versions.set(collection,(s.versions.get(collection)??0)+1));s.queries.set(key,watch);}
 return watch.read();
}

async function documents(db:Firestore,collection:Collection,ids:string[]){
 const s=store(db),missing=[...new Set(ids)].filter(id=>!s.documents.has(`${collection}/${id}`));
 for(let i=0;i<missing.length;i+=30){const batch=missing.slice(i,i+30);const group={users:0,ids:batch.map(id=>`${collection}/${id}`),watch:watchQuery(db.collection(collection).where(FieldPath.documentId(),'in',batch),()=>s.versions.set(collection,(s.versions.get(collection)??0)+1))};
  s.groups.add(group);for(const key of group.ids)s.documents.set(key,group);
 }
 const groups=new Set(ids.map(id=>s.documents.get(`${collection}/${id}`)!));
 // Pin this request's groups until their first snapshot arrives. Capacity eviction
 // closes idle subscriptions; it is not periodic expiry or request-time polling.
 for(const group of groups){group.users++;s.groups.delete(group);s.groups.add(group);}
 try {
 const values=await Promise.all([...groups].map(group=>group.watch.read()));
 const found=new Map(values.flatMap(value=>[...value]));
 return ids.map(id=>found.get(id)??({id,exists:false,ref:db.collection(collection).doc(id),data:()=>undefined,get:()=>undefined} as unknown as DocumentSnapshot));
 } finally {
  for(const group of groups)group.users--;
  while(s.groups.size>32){const old=[...s.groups].find(group=>group.users===0);if(!old)break;s.groups.delete(old);for(const key of old.ids)s.documents.delete(key);old.watch.close();}
 }
}
/** Undefined is reserved for non-listening test adapters, never network failures. */
export async function localDocuments(db:Firestore,collection:Collection,ids?:string[],query?:RelationshipQuery,_projection?:'marketCap',region?:ExchangeRegion):Promise<DocumentSnapshot[]|undefined>{
 if(typeof db.collection(collection).onSnapshot!=='function')return undefined;
 if(ids)return documents(db,collection,ids);
 const source=collection==='companies'?db.collection(collection).where('themeIds','array-contains-any',['ai','robotics','space']):db.collection(collection);
 if(collection==='company_fundamentals')throw Error('Fundamentals cache requires company IDs');
 let rows=[...(await localQuery(db,collection,source,collection)).values()];
 if(region)rows=rows.filter(doc=>doc.get('exchange_region')===region);
 if(query){
  if(query.status)rows=rows.filter(doc=>doc.get('status')===query.status);
  if(query.theme)rows=rows.filter(doc=>(doc.get('themeIds')??[]).includes(query.theme));
  if(query.companyIds||query.exactIds){const companies=new Set(query.companyIds),exact=new Set(query.exactIds);rows=rows.filter(doc=>exact.has(doc.id)||companies.has(doc.get('source'))||companies.has(doc.get('target')));}
  if(query.prefix!==undefined){const lower=Buffer.from(query.prefix),upper=Buffer.from(query.prefix+'\uf8ff');rows=rows.filter(doc=>Buffer.compare(Buffer.from(doc.id),lower)>=0&&Buffer.compare(Buffer.from(doc.id),upper)<0).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(0,query.limit??100);}
 }
 return rows;
}

export function localEntityVersions(db:Firestore){const s=store(db);return Object.fromEntries(['companies','company_fundamentals','company_relationships'].map(name=>[name,`local:${s.versions.get(name)??0}`]));}
