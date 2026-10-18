import { FieldPath, type Firestore, type Query, type DocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import { CHANGE_CACHE_DOCUMENT } from '../change-cache';
import { companySitemapPath } from '../ui/i18n/company-sitemaps';
const fields=['name','slug','market','status','description','classification','stage','source','sourceLabel'];
type Bucket={paths:Map<string,string>;checkpoint:Timestamp;version:string};
const caches=new WeakMap<Firestore,Map<string,Promise<Bucket>>>();
async function pages(query:Query){const result:DocumentSnapshot[]=[];let cursor;for(;;){const page=await (cursor?query.startAfter(cursor):query).limit(200).get();result.push(...page.docs);if(page.size<200)return result;cursor=page.docs.at(-1)!;}}
function apply(paths:Map<string,string>,docs:DocumentSnapshot[]){for(const doc of docs){const path=doc.exists?companySitemapPath(doc.id,doc.data()!):null;if(path)paths.set(doc.id,path);else paths.delete(doc.id);}}
/** Central-only: callers enable this after timestamp-capable writers and deletion
 * delivery are deployed. Keep all sitemap-eligible companies, not just graph members. */
export async function loadIncrementalSitemap(db:Firestore,prefix:string):Promise<string[]>{
 let buckets=caches.get(db);if(!buckets){buckets=new Map();caches.set(db,buckets);}
 const previous=buckets.get(prefix);
 const next=(async()=>{
  const old=await previous?.catch(()=>undefined);
  const metadata=await db.collection('collectors').doc(CHANGE_CACHE_DOCUMENT).get();
  const version=String(metadata.get('versions')?.companies??'initial'),enabled=metadata.get('enabled')===true;
  if(enabled&&old?.version===version)return old;
  const through=metadata.readTime;
  let query:Query=db.collection('companies').where(FieldPath.documentId(),'>=',prefix).where(FieldPath.documentId(),'<',prefix+'\uf8ff');
  const incremental=enabled&&old;
  if(incremental)query=query.where('cacheUpdatedAt','>=',old.checkpoint).where('cacheUpdatedAt','<=',through).orderBy('cacheUpdatedAt');
  query=query.orderBy(FieldPath.documentId()).select(...fields);
  const paths=incremental?new Map(old.paths):new Map<string,string>();
  apply(paths,await pages(query));
  if(incremental){
   const deleted=await pages(db.collection('collectors').where('cacheDeletedCollection','==','companies').where('cacheUpdatedAt','>=',old.checkpoint).where('cacheUpdatedAt','<=',through).orderBy('cacheUpdatedAt').orderBy(FieldPath.documentId()));
   const ids=[...new Set(deleted.map(doc=>doc.get('sourceId')).filter((id):id is string=>typeof id==='string'&&id.startsWith(prefix)))];
   for(let i=0;i<ids.length;i+=100){const current=await db.getAll(...ids.slice(i,i+100).map(id=>db.collection('companies').doc(id)),{fieldMask:fields});apply(paths,current);}
  }
  return {paths,checkpoint:through,version:enabled?version:'disabled'};
 })();
 buckets.set(prefix,next);
 try{return [...(await next).paths.entries()].sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([,path])=>path);}
 catch(error){if(buckets.get(prefix)===next){if(previous)buckets.set(prefix,previous);else buckets.delete(prefix);}throw error;}
}
