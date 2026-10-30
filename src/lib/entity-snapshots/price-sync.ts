import Database from 'better-sqlite3';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import {sqliteSnapshotFiles} from './sqlite-storage';
import {pricePartition} from './price-partition';
import type {Row,Source} from './sync';

/** Publish changed partitions first, then CAS the checkpoint. Failed runs replay safely. */
export async function syncPricePartitions(source:Source,bucket:Bucket){
 const checkpoint=bucket.file('price-snapshots/checkpoint.json');let generation='0',since:Timestamp|undefined;
 try{const [meta]=await checkpoint.getMetadata();generation=String(meta.generation);
  const [bytes]=await bucket.file(checkpoint.name,{generation}).download();const decoded=decode(JSON.parse(bytes.toString()).watermark);
  if(!(decoded instanceof Timestamp))throw Error('Invalid price sync checkpoint');since=decoded;
 }catch(error){if((error as {code?:number}).code!==404)throw error;}
 const through=await source.boundary();
 if(since&&since.toMillis()>through.toMillis())throw Error('Price watermark is in the future');
 // Spill compressed pages to a temporary database; only one ticker/year is
 // decoded at once. Cloud Run's temporary disk also counts against memory.
 const directory=await mkdtemp(join(tmpdir(),'price-changes-'));
 let staging:Database.Database|undefined;
 let changed=0,deleted=0,partitions=0;
 try{
 staging=new Database(join(directory,'changes.sqlite'));
 staging.exec('PRAGMA cache_size=-8192; PRAGMA journal_mode=OFF; CREATE TABLE changes (object TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(object,id)) WITHOUT ROWID');
 const insert=staging.prepare('INSERT OR REPLACE INTO changes VALUES(?,?,?)');
 const stage=staging.transaction((rows:Row[])=>{for(const row of rows){
  if(!(row.data.updatedAt instanceof Timestamp))throw Error('Price timestamp migration required');
  const part=pricePartition(row.id);if(!part)throw Error(`Unsupported price ID: ${row.id}`);
  insert.run(part.object,row.id,gzipSync(JSON.stringify(encode(row.data))));
  changed++;if(row.data.isDeleted===true)deleted++;
 }});
 const pages=source.pages?.('eod_prices',since,through)??(async function*(){yield await source.rows('eod_prices',since,through);})();
 for await(const page of pages)stage(page);
 let records=0;
 for(const {object} of staging.prepare('SELECT DISTINCT object FROM changes ORDER BY object').iterate() as Iterable<{object:string}>){
  partitions++;
  const rows=staging.prepare('SELECT id,payload FROM changes WHERE object=? ORDER BY id').all(object).map(value=>{const row=value as {id:string;payload:Buffer};return {id:row.id,data:decode(JSON.parse(gunzipSync(row.payload).toString()))} as Row;});
  const files=sqliteSnapshotFiles(bucket,()=>object);
  try{
   const previous=await files.load('eod_prices');
   if(previous.snapshot&&previous.snapshot.watermark.toMillis()>through.toMillis())throw Error('Newer price partition already published');
   const merged=new Map(previous.snapshot?.rows.map(row=>[row.id,row])??[]);
   for(const row of rows){if(row.data.isDeleted===true)merged.delete(row.id);else merged.set(row.id,row);}
   await files.save('eod_prices',{version:1,collection:'eod_prices',watermark:through,rows:[...merged.values()]},previous.generation);
   records+=merged.size;
  }finally{await files.close();}
 }
 await checkpoint.save(JSON.stringify({watermark:encode(through)}),{resumable:false,metadata:{contentType:'application/json',cacheControl:'private, no-cache'},preconditionOpts:{ifGenerationMatch:generation}});
 return {collection:'eod_prices',changed,partitions,records,deleted};
 }finally{staging?.close();await rm(directory,{recursive:true,force:true});}
}
