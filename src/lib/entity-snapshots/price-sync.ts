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
 const changes=await source.rows('eod_prices',since,through),groups=new Map<string,Row[]>();
 for(const row of changes){
  if(!(row.data.updatedAt instanceof Timestamp))throw Error('Price timestamp migration required');
  const part=pricePartition(row.id);if(!part)throw Error(`Unsupported price ID: ${row.id}`);
  const group=groups.get(part.object)??[];group.push(row);groups.set(part.object,group);
 }
 let records=0;
 for(const [object,rows] of groups){
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
 return {collection:'eod_prices',changed:changes.length,partitions:groups.size,records,deleted:changes.filter(row=>row.data.isDeleted===true).length};
}
