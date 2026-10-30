import type {Bucket} from '@google-cloud/storage';
import {createWriteStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {entitySqliteBuilder,openEntitySqlite} from './sqlite';
import type {Collection,Files,Snapshot} from './sync';

/** Daily sync storage: SQLite supplies both previous rows and the watermark.
 * Publication is conditional and atomic; the old object survives failed builds. */
export function sqliteSnapshotFiles(bucket:Bucket,objectFor:(collection:Collection)=>string=collection=>`entity-snapshots/${collection}.sqlite`):Files&{close():Promise<void>}{
 type Loaded={snapshot:Snapshot;generation:string;reader:ReturnType<typeof openEntitySqlite>;directory:string};
 const loaded=new Map<Collection,Loaded>();
 const release=async(collection:Collection)=>{
  const value=loaded.get(collection);if(!value)return;
  loaded.delete(collection);value.reader.close();await rm(value.directory,{recursive:true,force:true});
 };
 return {
  async load(collection){
   const cached=loaded.get(collection);if(cached)return {snapshot:cached.snapshot,generation:cached.generation};
   const object=objectFor(collection);
   let generation:string;
   try{const [meta]=await bucket.file(object).getMetadata();generation=String(meta.generation);}
   catch(error){if((error as {code?:number}).code===404)return {generation:'0'};throw error;}
   const directory=await mkdtemp(join(tmpdir(),'youanalyst-sync-')),path=join(directory,'snapshot.sqlite');
   let reader:ReturnType<typeof openEntitySqlite>|undefined;
   try{
    await pipeline(bucket.file(object,{generation}).createReadStream(),createWriteStream(path,{flags:'wx'}));
    reader=openEntitySqlite(path,undefined,collection);
    const snapshot:Snapshot={version:1,collection,watermark:reader.watermark,rows:[...reader.rows].map(([id,data])=>({id,data}))};
    loaded.set(collection,{snapshot,generation,reader,directory});
    return {snapshot,generation};
   }catch(error){reader?.close();await rm(directory,{recursive:true,force:true});throw error;}
  },
  async save(collection,snapshot,generation){
   if(snapshot.collection!==collection)throw Error('Snapshot collection mismatch');
   const directory=await mkdtemp(join(tmpdir(),'youanalyst-publish-')),path=join(directory,'snapshot.sqlite');
   let builder:ReturnType<typeof entitySqliteBuilder>|undefined;
   try{
    builder=entitySqliteBuilder(path,collection);
    for(const row of snapshot.rows)builder.add(row);
    builder.finish(snapshot.watermark);
    // GCS streams transparently decompress this representation for old readers.
    // Keep the same object, generation precondition, bytes and SQLite watermark.
    await bucket.upload(path,{destination:objectFor(collection),resumable:false,gzip:true,
     metadata:{contentType:'application/vnd.sqlite3',cacheControl:'private, no-cache'},preconditionOpts:{ifGenerationMatch:generation}});
    await release(collection);
   }finally{builder?.close();await rm(directory,{recursive:true,force:true});}
  },
  async close(){for(const collection of [...loaded.keys()])await release(collection);},
 };
}
