import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { COMPANY_SITEMAP_BUCKETS, companyBucketPrefix, companySitemapPath } from '../ui/i18n/company-sitemaps';
import {getAdminStorageBucket} from '../firebase/admin';
import {snapshotFiles} from '../entity-snapshots/storage';
import {companyDirectory,companyDirectoryEnabled} from './company-directory';

const prefixes = new Set(COMPANY_SITEMAP_BUCKETS.map(companyBucketPrefix).filter((p):p is string=>!!p));
type Paths = Map<string, readonly string[]>;
type Entry = {paths?:Paths;expires:number;pending?:Promise<Paths>};
type Options = {file?:()=>Promise<Paths|undefined>;now?:()=>number};
const DAY=24*60*60*1000;
declare global {var __youAnalystSitemapStoresV2:WeakMap<Firestore,Entry>|undefined;}
const stores=globalThis.__youAnalystSitemapStoresV2??=new WeakMap<Firestore,Entry>();
const directoryPaths=new WeakMap<object,Paths>();
function index(rows:Iterable<{id:string;path:string}>):Paths{
  const paths=new Map([...prefixes].map(prefix=>[prefix,[] as string[]]));
  for(const row of rows){
    const prefix=row.id.startsWith('ORG:')?'ORG:':row.id.startsWith('US:')?row.id.slice(0,4):row.id.slice(0,6);
    paths.get(prefix)?.push(row.path);
  }
  return new Map([...paths].map(([prefix,items])=>[prefix,Object.freeze([...new Set(items)].sort())]));
}
async function filePaths():Promise<Paths|undefined>{
  const bucket=process.env.ENTITY_SNAPSHOT_BUCKET?.trim()||process.env.EODHD_BULK_EOD_BUCKET?.trim();
  if(!bucket)return undefined;
  // Project while streaming: never retain the full company directory in the web process.
  const {snapshot}=await snapshotFiles(getAdminStorageBucket(bucket)).load('companies',row=>{
    const path=companySitemapPath(row.id,row.data);
    return path?{id:row.id,data:{path}}:undefined;
  });
  return snapshot?index(snapshot.rows.map(row=>({id:row.id,path:String(row.data.path)}))):undefined;
}
async function firestorePaths(db:Firestore):Promise<Paths>{
  const base=db.collection('companies').select('name','slug','status','market','isDeleted','source','sourceLabel').orderBy(FieldPath.documentId());
  const rows:{id:string;path:string}[]=[];let cursor:string|undefined;
  for(;;){
    const page=await(cursor?base.startAfter(cursor):base).limit(500).get();
    for(const doc of page.docs){const path=companySitemapPath(doc.id,doc.data());if(path)rows.push({id:doc.id,path});}
    if(page.size<500)break;
    cursor=page.docs[page.docs.length-1].id;
  }
  return index(rows);
}
export async function loadSitemapPaths(db:Firestore,prefix:string,options:Options={}):Promise<readonly string[]>{
  if(!prefixes.has(prefix))throw Error('Invalid sitemap prefix');
  if(!options.file&&companyDirectoryEnabled(db)){
    const rows=await companyDirectory(db);
    let paths=directoryPaths.get(rows);
    if(!paths){paths=index([...(rows.sitemapRows?.()??rows)].flatMap(([id,data])=>{const path=companySitemapPath(id,data);return path?[{id,path}]:[];}));directoryPaths.set(rows,paths);}
    return paths.get(prefix)??Object.freeze([]);
  }
  const now=options.now??Date.now;
  let entry=stores.get(db);
  if(!entry){entry={expires:0};stores.set(db,entry);}
  if(entry.paths&&now()<entry.expires)return entry.paths.get(prefix)??Object.freeze([]);
  const current=entry;
  if(!current.pending){
    current.pending=Promise.resolve().then(async()=>{
      // Only an absent file falls back. Permission/corruption/network failures
      // must not silently turn crawler traffic into full Firestore scans.
      const paths=await(options.file??filePaths)()??await firestorePaths(db);
      current.paths=paths;current.expires=now()+DAY;return paths;
    }).catch(error=>{
      if(!current.paths)throw error;
      console.warn('Sitemap snapshot refresh failed; retaining cached paths',error instanceof Error?error.message:String(error));
      current.expires=now()+60_000;return current.paths;
    }).finally(()=>{current.pending=undefined;});
  }
  return (await current.pending).get(prefix)??Object.freeze([]);
}
