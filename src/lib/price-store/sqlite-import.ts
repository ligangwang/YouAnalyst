import {mkdtemp,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {Timestamp} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {decode} from '../central-cache/codec';
import {openEntitySqlite} from '../entity-snapshots/sqlite';
import {pricePartition} from '../entity-snapshots/price-partition';
import type {Row} from '../entity-snapshots/sync';
import {PriceStore,readHead,saveHead,ROOT} from './storage';
import {readPriceParquet} from './parquet';

type Source={name:string;generation:string;encoding:string;md5:boolean};
type Inventory={watermark:[number,number];files:Source[]};
const INVENTORY=`${ROOT}/sqlite-inventory.json`;
async function inventory(bucket:Bucket):Promise<Inventory>{
 try{const [bytes]=await bucket.file(INVENTORY).download();return JSON.parse(bytes.toString());}
 catch(error){if((error as {code?:number}).code!==404)throw error;}
 // The completed checkpoint covers all partitions, including unchanged files.
 // Pin every generation so a daily publication cannot change a resumed import.
 const [progress]=await bucket.file('price-snapshots/progress.json').download();
 if(decode(JSON.parse(progress.toString())).pending)throw Error('Wait for SQLite snapshot publication to finish');
 const [checkpoint]=await bucket.file('price-snapshots/checkpoint.json').download();
 const watermark=decode(JSON.parse(checkpoint.toString()).watermark);
 if(!(watermark instanceof Timestamp))throw Error('Missing SQLite checkpoint');
 const [objects]=await bucket.getFiles({prefix:'price-snapshots/'});
 const files=objects.filter(f=>/^price-snapshots\/(US|CN_A|FX)\/[^/]+\/[0-9]{4}\.sqlite$/.test(f.name))
  .map(f=>({name:f.name,generation:String(f.metadata.generation),encoding:f.metadata.contentEncoding??'identity',md5:!!f.metadata.md5Hash}))
  .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(!files.length||files.some(f=>!/^\d+$/.test(f.generation)))throw Error('Invalid SQLite inventory');
 const value:Inventory={watermark:[watermark.seconds,watermark.nanoseconds],files};
 await bucket.file(INVENTORY).save(JSON.stringify(value),{resumable:false,preconditionOpts:{ifGenerationMatch:0}});
 return value;
}
async function readSource(bucket:Bucket,source:Source):Promise<Row[]>{
 if(!['identity','gzip'].includes(source.encoding))throw Error('Invalid SQLite encoding');
 const directory=await mkdtemp(join(tmpdir(),'price-import-')),path=join(directory,'source.sqlite');
 try{
  const input=bucket.file(source.name,{generation:source.generation}).createReadStream({decompress:false,validation:source.md5?'md5':'crc32c'});
  const output=createWriteStream(path);
  if(source.encoding==='gzip')await pipeline(input,createGunzip(),output);else await pipeline(input,output);
  const opened=openEntitySqlite(path,undefined,'eod_prices');
  try{
   const rows=[...opened.rows].map(([id,data])=>({id,data:{...data}}));
   for(const row of rows)if(pricePartition(row.id)?.object!==source.name)throw Error('SQLite partition identity mismatch');
   return rows;
  }finally{opened.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
}

/** Historical conversion uses only GCS: zero Firestore reads. Each checkpoint
 * follows a complete, uploaded and field-for-field verified conversion batch. */
export async function importSqlitePrices(store:PriceStore,maxFiles=10000,maxDurationMs=1200000){
 const source=await inventory(store.bucket),deadline=Date.now()+maxDurationMs;
 let head=await readHead(store.bucket),processed=0;
 if(head.manifest.source!=='sqlite'){
  if(head.manifest.ready)throw Error('Refuse to replace an active price store');
  if(head.manifest.files.length)try{
   await store.bucket.file(`${ROOT}/firestore-export-aborted.json`).save(JSON.stringify(head),{resumable:false,preconditionOpts:{ifGenerationMatch:0}});
  }catch(error){if((error as {code?:number}).code!==412)throw error;}
  await saveHead(store.bucket,head,{version:1,ready:false,files:[],source:'sqlite',sourceCursor:0,sourceFiles:source.files.length,watermark:source.watermark});
  head=await readHead(store.bucket);
 }
 while((head.manifest.sourceCursor??0)<source.files.length&&processed<maxFiles&&Date.now()<deadline){
  const start=head.manifest.sourceCursor??0,end=Math.min(start+256,source.files.length,start+maxFiles-processed),rows:Row[]=[];
  for(let i=start;i<end;i+=16){
   const batch=await Promise.allSettled(source.files.slice(i,Math.min(i+16,end)).map(f=>readSource(store.bucket,f)));
   for(const result of batch){if(result.status==='rejected')throw result.reason;rows.push(...result.value);}
  }
  rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const file=rows.length?await store.upload(rows):undefined;
  if(file){const restored=await store.local([file.name],paths=>readPriceParquet(paths[0]));if(!isDeepStrictEqual(rows,restored))throw Error('SQLite to Parquet parity failed');}
  await saveHead(store.bucket,head,{...head.manifest,sourceCursor:end,files:[...head.manifest.files,...(file?[file]:[])]});
  head=await readHead(store.bucket);processed+=end-start;
  console.info(JSON.stringify({event:'price_sqlite_import',partitions:end,total:source.files.length,rows:head.manifest.files.reduce((n,f)=>n+f.rows,0),firestoreReads:0}));
 }
 const complete=head.manifest.sourceCursor===source.files.length;
 // Activation is deliberately separate from conversion and requires coverage review.
 return {status:complete?'converted':'partial',partitions:head.manifest.sourceCursor,total:source.files.length,rows:head.manifest.files.reduce((n,f)=>n+f.rows,0),firestoreReads:0};
}
