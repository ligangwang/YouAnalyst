import Database from 'better-sqlite3';
import type {Bucket} from '@google-cloud/storage';
import {Timestamp,type DocumentData} from 'firebase-admin/firestore';
import {createWriteStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {encode,decode} from '../central-cache/codec';
import type {Row,Collection} from './sync';

export const COMPANY_SQLITE_OBJECT='entity-snapshots/companies.sqlite';
const FORMAT='youanalyst-entities-v1-lazy';
const scalarFields=['slug','symbol','symbolLower','nameLower','tickerLower','name','legalName','status','market','exchange_region','companyId','source','target','instrumentType','exchange','historyKey','ticker','tradingDate','requestedDate'];
const arrayFields=['themeIds','slugAliases','aliases'];
export type EntityRows=Map<string,DocumentData>&{watermark?:Timestamp;overlayBase?:EntityRows;overlayIds?:Set<string>;candidateIds?:(field:string,operator:string,value:unknown)=>Set<string>|undefined; sitemapRows?:()=>Iterable<[string,DocumentData]>; isDeleted?:(id:string)=>boolean; decodedCount?:()=>number};

/** Builder is used only by the daily job. Readers never build search indexes. */
export function entitySqliteBuilder(path:string,collection:Collection='companies'){
 const db=new Database(path);let sequence=0,finished=false;
 let searchRows=0;
 db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-16384;
 CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;
 CREATE TABLE companies(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,prefixes BLOB);
 CREATE TABLE sitemap(id TEXT PRIMARY KEY,payload TEXT NOT NULL) WITHOUT ROWID;
 CREATE TABLE lookups(field TEXT NOT NULL,value TEXT NOT NULL,company_seq INTEGER NOT NULL,PRIMARY KEY(field,value,company_seq)) WITHOUT ROWID;
 CREATE VIRTUAL TABLE company_search USING fts5(terms, tokenize="trigram case_sensitive 1");
 BEGIN IMMEDIATE;`);
 const insert=db.prepare('INSERT INTO companies VALUES(?,?,?,?)');
 const sitemap=db.prepare('INSERT INTO sitemap VALUES(?,?)');
 const lookup=db.prepare('INSERT OR IGNORE INTO lookups VALUES(?,?,?)');
 const search=db.prepare('INSERT INTO company_search(rowid,terms) VALUES(?,?)');
 return {
  add(row:Row){
   if(finished)throw Error('Entity SQLite builder is closed');
   if(row.data.isDeleted===true)return;
   const seq=++sequence,{searchPrefixes,...data}=row.data;
   // Preserve the original field losslessly for callers that request full data.
   const encodedPrefixes=searchPrefixes===undefined?null:gzipSync(JSON.stringify(encode(searchPrefixes)));
   insert.run(seq,row.id,JSON.stringify(encode(data)),encodedPrefixes);
   if(collection==='eod_prices') {
    for(const name of scalarFields)if(typeof data[name]==='string')lookup.run(name,data[name],seq);
    for(const name of arrayFields)if(Array.isArray(data[name]))for(const value of data[name])if(typeof value==='string')lookup.run(name,value,seq);
    return;
   }
   const projected=Object.fromEntries(['name','slug','status','market','isDeleted','source','sourceLabel'].filter(key=>key in data).map(key=>[key,data[key]]));
   sitemap.run(row.id,JSON.stringify(encode(projected)));
   for(const name of scalarFields)if(typeof data[name]==='string')lookup.run(name,data[name],seq);
   for(const name of arrayFields)if(Array.isArray(data[name]))for(const value of data[name])if(typeof value==='string')lookup.run(name,value,seq);
   const terms=[row.id,data.symbol,data.name,data.legalName,...(Array.isArray(data.searchTerms)?data.searchTerms:[]),
    ...Object.values(data.names??{}),...(Array.isArray(data.aliases)?data.aliases:[])];
   let body=terms.filter((v):v is string=>typeof v==='string').flatMap(v=>[v.toLowerCase(),v.toLowerCase().replace(/\s+/g,'')]).join('\n');
   if(Array.isArray(searchPrefixes))for(const prefix of new Set(searchPrefixes))if(typeof prefix==='string'){
    if([...prefix].length<3||prefix.includes('\0'))lookup.run('searchPrefixes',prefix,seq);
    else if(!body.includes(prefix))body+='\n'+prefix;
   }
   search.run(seq,body);searchRows++;

  },
  finish(watermark:Timestamp){
   if(finished)throw Error('Entity SQLite builder is closed');
   try{
    const meta=db.prepare('INSERT INTO metadata VALUES(?,?)');
    meta.run('format',FORMAT);meta.run('collection',collection);meta.run('watermark',JSON.stringify(encode(watermark)));meta.run('records',String(sequence));
    db.exec("INSERT INTO company_search(company_search) VALUES('optimize'); COMMIT; ANALYZE;");
    const check=db.pragma('quick_check',{simple:true});if(check!=='ok')throw Error('Invalid built entity SQLite database');
    return {records:sequence,indexedSearchRows:searchRows};
   }finally{finished=true;db.close();}
  },
  close(){if(!finished){finished=true;db.close();}},
 };
}

// A retired directory can still be referenced by an in-flight reader. Close it
// only after the map is unreachable, rather than invalidating an active query.
const cleanup=new FinalizationRegistry<{db:Database.Database;directory?:string}>(resource=>{
 try{resource.db.close();}catch{/* Already explicitly closed. */}
 if(resource.directory)void rm(resource.directory,{recursive:true,force:true}).catch(()=>{});
});
export function openEntitySqlite(path:string,directory?:string,collection:Collection='companies'):{rows:EntityRows;watermark:Timestamp;close:()=>void}{
 const db=new Database(path,{readonly:true,fileMustExist:true});
 try{
  db.pragma('query_only = ON');db.pragma('cache_size = -8192');
  const meta=new Map((db.prepare('SELECT key,value FROM metadata').all() as {key:string;value:string}[]).map(row=>[row.key,row.value]));
  if(meta.get('format')!==FORMAT)throw Error('Unsupported entity SQLite format');
  if(meta.get('collection')!==collection)throw Error('Wrong SQLite snapshot collection');
  const watermark=decode(JSON.parse(meta.get('watermark')??'null'));
  if(!(watermark instanceof Timestamp))throw Error('Invalid entity SQLite watermark');
  const rows:EntityRows=new Map(),ids=new Map<number,string>();
  const lifetime={db};
  const originals=new Map<string,DocumentData>();let decodedCount=0;
  const read=db.prepare('SELECT payload,prefixes FROM companies WHERE id=?');
  for(const record of db.prepare('SELECT seq,id FROM companies ORDER BY seq').iterate() as Iterable<{seq:number;id:string}>){
   // Each proxy retains its decoded object after the first requested field.
   // Listing keys or opening the database never fetches company payloads.
   const target:DocumentData={};let loaded=false;
   const load=()=>{
    if(loaded)return;
    if(!lifetime.db.open)throw Error('Entity SQLite reader is closed');
    const stored=read.get(record.id) as {payload:string;prefixes:Buffer|null};
    const data=decode(JSON.parse(stored.payload));
    if(!data||typeof data!=='object'||Array.isArray(data)||data.isDeleted===true)throw Error('Invalid entity SQLite row');
    Object.assign(target,data);
    if(stored.prefixes){const bytes=stored.prefixes;Object.defineProperty(target,'searchPrefixes',{enumerable:true,configurable:true,get:()=>decode(JSON.parse(gunzipSync(bytes).toString()))});}
    loaded=true;decodedCount++;
   };
   const data=new Proxy(target,{
    get:(object,key)=>{load();return Reflect.get(object,key);},
    ownKeys:object=>{load();return Reflect.ownKeys(object);},
    getOwnPropertyDescriptor:(object,key)=>{load();return Reflect.getOwnPropertyDescriptor(object,key);},
    has:(object,key)=>{load();return Reflect.has(object,key);},
   });
   rows.set(record.id,data);originals.set(record.id,data);ids.set(record.seq,record.id);
  }
  rows.watermark=watermark;
  rows.decodedCount=()=>{if(!lifetime.db.open)throw Error('Entity SQLite reader is closed');return decodedCount;};
  rows.isDeleted=id=>{const row=rows.get(id);return row===originals.get(id)?false:row?.isDeleted===true;};
  rows.sitemapRows=function*(){
   if(!lifetime.db.open)throw Error('Entity SQLite reader is closed');
   const seen=new Set<string>();
   for(const record of db.prepare('SELECT id,payload FROM sitemap ORDER BY id').iterate() as Iterable<{id:string;payload:string}>){
    seen.add(record.id);const row=rows.get(record.id);
    if(row)yield [record.id,row===originals.get(record.id)?decode(JSON.parse(record.payload)):row];
   }
   for(const [id,row] of rows)if(!seen.has(id))yield [id,row];
  };
  if(String(rows.size)!==meta.get('records'))throw Error('Incomplete entity SQLite directory');
  const lookup=db.prepare('SELECT company_seq FROM lookups WHERE field=? AND value=?');
  const search=db.prepare('SELECT rowid AS company_seq FROM company_search WHERE company_search MATCH ?');
  rows.candidateIds=(field,operator,value)=>{
   if(!lifetime.db.open)throw Error('Entity SQLite reader is closed');
   const array=operator==='array-contains'||operator==='array-contains-any';
   const range=['<','<=','>','>='].includes(operator);
   const scalar=operator==='=='||operator==='in'||range;
   if(!(array&&(arrayFields.includes(field)||field==='searchPrefixes'))&&!(scalar&&(scalarFields.includes(field)||field==='__name__')))return undefined;
   const values=operator==='in'||operator==='array-contains-any'?value:[value];
   if(!Array.isArray(values)||values.some(v=>typeof v!=='string'))return undefined;
   const found=new Set<string>();
   if(range||field==='__name__'){
    const op=range?operator:'=';
    const statement=field==='__name__'?db.prepare(`SELECT seq AS company_seq FROM companies WHERE id ${op} ?`):db.prepare(`SELECT company_seq FROM lookups WHERE field=? AND value ${op} ?`);
    for(const v of values)for(const row of (field==='__name__'?statement.all(v):statement.all(field,v)) as {company_seq:number}[]){const id=ids.get(row.company_seq);if(id)found.add(id);}
    return found;
   }
   for(const v of values){
    const statement=field==='searchPrefixes'&&[...v].length>=3&&!v.includes('\0')?search:lookup;
    const entries=(statement===search?search.all('"'+v.replaceAll('"','""')+'"'):lookup.all(field,v)) as {company_seq:number}[];

    for(const {company_seq:seq} of entries){const id=ids.get(seq);if(!id)throw Error('Invalid entity SQLite index reference');found.add(id);}
   }
   return found;
  };
  const token={};cleanup.register(lifetime,{db,directory},token);
  return {rows,watermark,close:()=>{cleanup.unregister(token);db.close();}};
 }catch(error){db.close();throw error;}
}

export function inheritEntitySqliteIndex(previous:EntityRows,next:EntityRows,changed:Iterable<string>){
 const base=previous.overlayBase??previous;
 const dirty=new Set([...(previous.overlayIds??[]),...changed]);
 next.overlayBase=base;next.overlayIds=dirty;next.watermark=previous.watermark;
 next.decodedCount=base.decodedCount;
 next.isDeleted=id=>next.get(id)===base.get(id)?(base.isDeleted?.(id)??base.get(id)?.isDeleted===true):next.get(id)?.isDeleted===true;
 if(base.sitemapRows)next.sitemapRows=function*(){
  const seen=new Set<string>();
  for(const [id,projection] of base.sitemapRows!()){seen.add(id);const row=next.get(id);if(row)yield [id,row===base.get(id)?projection:row];}
  for(const [id,row] of next)if(!seen.has(id))yield [id,row];
 };
 if(base.candidateIds){const query=base.candidateIds.bind(base);next.candidateIds=(field,operator,value)=>{
  const ids=query(field,operator,value);if(ids)for(const id of dirty)ids.add(id);return ids;
 };}
 return next;
}

/** Return undefined only for an absent SQLite file, never for an invalid file. */
export async function loadEntitySqlite(bucket:Bucket,reason:'cold'|'refresh',log:(entry:Record<string,unknown>)=>void=entry=>console.info(JSON.stringify(entry)),collection:Collection='companies'):Promise<EntityRows|undefined>{
 const object=`entity-snapshots/${collection}.sqlite`;
 const started=performance.now();let metadataMs=0,downloadMs=0,processingMs=0,bytesDownloaded=0,records=0,status='error',directory:string|undefined;
 try{
  const file=bucket.file(object);let generation:string;
  try{const [meta]=await file.getMetadata();generation=String(meta.generation);}
  catch(error){if((error as {code?:number}).code===404){status='missing';return undefined;}throw error;}
  finally{metadataMs=performance.now()-started;}
  directory=await mkdtemp(join(tmpdir(),'youanalyst-entities-'));const path=join(directory,'companies.sqlite');
  let phase=performance.now();
  const input=bucket.file(object,{generation}).createReadStream();
  input.on('data',(chunk:Buffer)=>{bytesDownloaded+=chunk.length;});
  try{await pipeline(input,createWriteStream(path,{flags:'wx'}));}finally{downloadMs=performance.now()-phase;}
  phase=performance.now();
  let opened:ReturnType<typeof openEntitySqlite>;
  try{opened=openEntitySqlite(path,directory,collection);}finally{processingMs=performance.now()-phase;}
  records=opened.rows.size;directory=undefined;status='success';return opened.rows;
 }finally{
  if(directory)await rm(directory,{recursive:true,force:true});
  const ms=(n:number)=>Math.round(n*100)/100;
  try{log({event:'entity_snapshot_file_read',format:'sqlite',collection,reason,status,
   metadataMs:ms(metadataMs),downloadMs:ms(downloadMs),processingMs:ms(processingMs),totalMs:ms(performance.now()-started),
   bytesDownloaded,rowsIndexed:records,rowsDecoded:0,timingsOverlap:false,revision:process.env.K_REVISION,job:process.env.CLOUD_RUN_JOB});}catch{/* Observability cannot fail a read. */}
 }
}

