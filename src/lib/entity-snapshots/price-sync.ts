import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import {sqliteSnapshotFiles} from './sqlite-storage';
import {pricePartition} from './price-partition';
import type {Row,Source,PriceCursor,PricePage} from './sync';

const PROGRESS='price-snapshots/progress.json';
const CHECKPOINT='price-snapshots/checkpoint.json';
// Longer than the deployed task's hard 30-minute timeout. A killed worker
// cannot overlap a successor; normal exits release the lease immediately.
const LEASE_MS=35*60_000;
export type PriceSyncOptions={maxReads?:number;maxPartitions?:number;maxDurationMs?:number;pageSize?:number;publishConcurrency?:number;now?:()=>number};
type Pending={id:string;since?:Timestamp;through:Timestamp;checkpointGeneration:string;
 cursor?:PriceCursor;pages:number;scanned:boolean;lastPublished?:string;cleanup?:number};
type Progress={version:1;owner:string;leaseUntil:number;pending?:Pending};

async function readObject(bucket:Bucket,name:string){
 let generation:string;
 try{const [meta]=await bucket.file(name).getMetadata();generation=String(meta.generation);}
 catch(error){if((error as {code?:number}).code===404)return;throw error;}
 // A disappeared pinned generation is an error, never a fresh initial scan.
 const [bytes]=await bucket.file(name,{generation}).download();return {generation,bytes};
}
function positive(value:number,name:string){if(!Number.isSafeInteger(value)||value<1)throw Error(`Invalid ${name}`);return value;}
export function priceSyncOptions(env:Record<string,string|undefined>=process.env):PriceSyncOptions {
 return {maxReads:positive(Number(env.PRICE_SYNC_MAX_READS??50_000),'PRICE_SYNC_MAX_READS'),
  maxPartitions:positive(Number(env.PRICE_SYNC_MAX_PARTITIONS??500),'PRICE_SYNC_MAX_PARTITIONS'),
  pageSize:positive(Number(env.PRICE_SYNC_PAGE_SIZE??250),'PRICE_SYNC_PAGE_SIZE'),
  publishConcurrency:positive(Number(env.PRICE_SYNC_PUBLISH_CONCURRENCY??1),'PRICE_SYNC_PUBLISH_CONCURRENCY'),
  maxDurationMs:positive(Number(env.PRICE_SYNC_MAX_DURATION_MS??20*60_000),'PRICE_SYNC_MAX_DURATION_MS')};
}

/** Durable page journal, fixed scan boundary, and a cursor including timestamp
 * nanoseconds + ID. No public partition advances until the scan is complete. */
export async function syncPricePartitions(source:Source,bucket:Bucket,options:PriceSyncOptions={}){
 const maxReads=positive(options.maxReads??50_000,'maxReads');
 const maxPartitions=positive(options.maxPartitions??500,'maxPartitions');
 const pageSize=positive(options.pageSize??250,'pageSize'),publishConcurrency=positive(options.publishConcurrency??1,'publishConcurrency');
 if(pageSize>5000||publishConcurrency>8)throw Error('Price page/concurrency limit exceeded');
 const now=options.now??Date.now,deadline=now()+positive(options.maxDurationMs??20*60_000,'maxDurationMs');
 if(!source.pricePage)throw Error('Bounded price page source required');
 const stored=await readObject(bucket,PROGRESS);
 let generation=stored?.generation??'0';
 const progress:Progress=stored?decode(JSON.parse(stored.bytes.toString())) as Progress:{version:1,owner:'',leaseUntil:0};
 if(progress.version!==1||!Number.isFinite(progress.leaseUntil))throw Error('Invalid price sync progress');
 if(progress.leaseUntil>now())return {collection:'eod_prices',status:'busy',changed:0,reads:0,partitions:0,records:0,deleted:0};
 progress.owner=randomUUID();
 const persist=async()=>{
  const revision=randomUUID();
  await bucket.file(PROGRESS).save(JSON.stringify(encode({...progress,revision})),{resumable:false,
   metadata:{contentType:'application/json',cacheControl:'private, no-cache'},preconditionOpts:{ifGenerationMatch:generation}});
  const saved=await readObject(bucket,PROGRESS);
  if(!saved||decode(JSON.parse(saved.bytes.toString())).revision!==revision)throw Error('Price sync lease lost');
  generation=saved.generation;
 };
 progress.leaseUntil=now()+LEASE_MS;await persist();
 let changed=0,reads=0,partitions=0,records=0,deleted=0;
 const result=(status:'partial'|'complete')=>({collection:'eod_prices',status,changed,reads,partitions,records,deleted});
 let directory:string|undefined,staging:Database.Database|undefined;
 try{
  if(!progress.pending){
   const checkpoint=await readObject(bucket,CHECKPOINT);
   const since=checkpoint?decode(JSON.parse(checkpoint.bytes.toString()).watermark) as Timestamp:undefined;
   if(checkpoint&&!(since instanceof Timestamp))throw Error('Invalid price sync checkpoint');
   const through=await source.boundary();
   if(since&&since.valueOf()>through.valueOf())throw Error('Price watermark is in the future');
   progress.pending={id:randomUUID(),since,through,checkpointGeneration:checkpoint?.generation??'0',pages:0,scanned:false};
   await persist();
  }
  const pending=progress.pending;
  if(!(pending.through instanceof Timestamp)||(pending.since!==undefined&&!(pending.since instanceof Timestamp)))throw Error('Invalid pending price boundary');
  if(typeof pending.id!=='string'||!/^[a-f0-9-]{36}$/.test(pending.id)||!Number.isSafeInteger(pending.pages)||pending.pages<0||typeof pending.scanned!=='boolean'||typeof pending.checkpointGeneration!=='string'||
   (pending.cursor&&(typeof pending.cursor.id!=='string'||(pending.since&&!(pending.cursor.updatedAt instanceof Timestamp))))||
   (pending.pages>0&&!pending.scanned&&!pending.cursor)||
   (pending.cleanup!==undefined&&(!pending.scanned||!Number.isSafeInteger(pending.cleanup)||pending.cleanup<0||pending.cleanup>pending.pages)))throw Error('Invalid pending price progress');
  const pageName=(n:number)=>`price-snapshots/staging/${pending.id}/${n}.json.gz`;
  while(!pending.scanned&&reads<maxReads&&now()<deadline){
   // Recover an uploaded page even if the process died before saving its cursor.
   const saved=await readObject(bucket,pageName(pending.pages));
   const page:PricePage=saved?decode(JSON.parse(gunzipSync(saved.bytes).toString())) as PricePage:
    await source.pricePage(pending.since,pending.through,pending.cursor,Math.min(pageSize,maxReads-reads));
   if(!saved)reads+=page.reads;
   if(!Number.isInteger(page.reads)||page.reads<1||page.reads>5000||(!page.done&&!page.cursor))throw Error('Invalid price page');
   for(const row of page.rows){
    if(!(row.data.updatedAt instanceof Timestamp))throw Error('Price timestamp migration required');
    if(!pricePartition(row.id))throw Error(`Unsupported price ID: ${row.id}`);
   }
   if(!saved)await bucket.file(pageName(pending.pages)).save(gzipSync(JSON.stringify(encode(page))),{resumable:false,
    metadata:{contentType:'application/octet-stream'},preconditionOpts:{ifGenerationMatch:0}});
   pending.cursor=page.cursor;pending.pages++;pending.scanned=page.done;
   changed+=page.rows.length;deleted+=page.rows.filter(row=>row.data.isDeleted===true).length;
   await persist();
   if(pending.pages%100===0)console.info(JSON.stringify({event:'price_sync_progress',phase:'scan',scanId:pending.id,savedPages:pending.pages,reads,cursor:pending.cursor}));
  }
  if(!pending.scanned||now()>=deadline)return result('partial');
  if(pending.cleanup===undefined){
   // Disk staging bounds decoded memory to one ticker/year. An unfinished
   // index and its embedded page cursor survive bounded execution deadlines.
   directory=await mkdtemp(join(tmpdir(),'price-changes-'));
   const indexPath=join(directory,'changes.sqlite'),indexName=`price-snapshots/staging/${pending.id}/changes.sqlite`;
   const partialName=`price-snapshots/staging/${pending.id}/partial.sqlite`;
   let indexGeneration:string|undefined;
   try{const [meta]=await bucket.file(indexName).getMetadata();indexGeneration=String(meta.generation);}
   catch(error){if((error as {code?:number}).code!==404)throw error;}
   if(indexGeneration){
    await pipeline(bucket.file(indexName,{generation:indexGeneration}).createReadStream(),createWriteStream(indexPath,{flags:'wx'}));
    staging=new Database(indexPath,{readonly:true});
   }else{
    let partialGeneration:string|undefined;
    try{const [meta]=await bucket.file(partialName).getMetadata();partialGeneration=String(meta.generation);}
    catch(error){if((error as {code?:number}).code!==404)throw error;}
    if(partialGeneration)await pipeline(bucket.file(partialName,{generation:partialGeneration}).createReadStream(),createWriteStream(indexPath,{flags:'wx'}));
    staging=new Database(indexPath);
    staging.exec('PRAGMA cache_size=-8192; PRAGMA journal_mode=OFF');
    if(!partialGeneration)staging.exec('CREATE TABLE changes (object TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(object,id)) WITHOUT ROWID; CREATE TABLE index_progress (next_page INTEGER NOT NULL); INSERT INTO index_progress VALUES(0)');
    const nextPage=(staging.prepare('SELECT next_page FROM index_progress').get() as {next_page:number}).next_page;
    if(!Number.isSafeInteger(nextPage)||nextPage<0||nextPage>pending.pages)throw Error('Invalid saved price index progress');
    const insert=staging.prepare('INSERT OR REPLACE INTO changes VALUES(?,?,?)');
    const stage=staging.transaction((rows:Row[])=>{for(const row of rows){
     const object=pricePartition(row.id)!.object;
     insert.run(object,row.id,gzipSync(JSON.stringify(encode(row.data))));
    }});
    for(let n=nextPage;n<pending.pages;n+=16){
     if(now()>=deadline){
      staging.close();staging=undefined;
      await bucket.upload(indexPath,{destination:partialName,resumable:true,metadata:{contentType:'application/vnd.sqlite3'},preconditionOpts:{ifGenerationMatch:partialGeneration??0}});
      return result('partial');
     }
     const batch=await Promise.all(Array.from({length:Math.min(16,pending.pages-n)},(_,i)=>readObject(bucket,pageName(n+i))));
     for(const page of batch){
      if(!page)throw Error('Missing saved price page');
      stage((decode(JSON.parse(gunzipSync(page.bytes).toString())) as PricePage).rows);
     }
     staging.prepare('UPDATE index_progress SET next_page=?').run(Math.min(n+16,pending.pages));
     if(n%160===0)console.info(JSON.stringify({event:'price_sync_progress',phase:'index',indexedPages:Math.min(n+16,pending.pages),savedPages:pending.pages}));
    }
    staging.close();staging=undefined;
    // Immutable index: later publication runs need one download, not another
    // download/decode/regroup of every saved page. Existing page journals work.
    await bucket.upload(indexPath,{destination:indexName,resumable:true,metadata:{contentType:'application/vnd.sqlite3'},preconditionOpts:{ifGenerationMatch:0}});
    staging=new Database(indexPath,{readonly:true});
   }
   const objects=(staging.prepare('SELECT DISTINCT object FROM changes WHERE object>? ORDER BY object').all(pending.lastPublished??'') as {object:string}[]).map(row=>row.object);
   for(let offset=0;offset<objects.length;){
    if(partitions>=maxPartitions||now()>=deadline)return result('partial');
    const batch=objects.slice(offset,offset+Math.min(publishConcurrency,maxPartitions-partitions));
    // Wait for every upload, including failures, before advancing or releasing
    // the lease. A failed batch replays idempotently from the prepared index.
    const published=await Promise.allSettled(batch.map(async object=>{
     const rows=staging!.prepare('SELECT id,payload FROM changes WHERE object=? ORDER BY id').all(object).map(value=>{
      const row=value as {id:string;payload:Buffer};return {id:row.id,data:decode(JSON.parse(gunzipSync(row.payload).toString()))} as Row;
     });
     const files=sqliteSnapshotFiles(bucket,()=>object);
     try{
      const previous=await files.load('eod_prices');
      if(previous.snapshot&&previous.snapshot.watermark.valueOf()>pending.through.valueOf())throw Error('Newer price partition already published');
      const merged=new Map(previous.snapshot?.rows.map(row=>[row.id,row])??[]);
      for(const row of rows){if(row.data.isDeleted===true)merged.delete(row.id);else merged.set(row.id,row);}
      await files.save('eod_prices',{version:1,collection:'eod_prices',watermark:pending.through,rows:[...merged.values()]},previous.generation);
      return merged.size;
     }finally{await files.close();}
    }));
    const failure=published.find(value=>value.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    for(const value of published)if(value.status==='fulfilled')records+=value.value;
    partitions+=batch.length;offset+=batch.length;
    pending.lastPublished=batch.at(-1);await persist();
    if(partitions%100===0)console.info(JSON.stringify({event:'price_sync_progress',phase:'publish',partitions,lastPublished:pending.lastPublished}));
   }
   const latest=await readObject(bucket,CHECKPOINT);
   const watermark=latest?decode(JSON.parse(latest.bytes.toString()).watermark) as Timestamp:undefined;
   // Recover a crash between checkpoint publication and progress persistence.
   if(!watermark?.isEqual(pending.through))await bucket.file(CHECKPOINT).save(JSON.stringify({watermark:encode(pending.through)}),{resumable:false,
    metadata:{contentType:'application/json',cacheControl:'private, no-cache'},preconditionOpts:{ifGenerationMatch:pending.checkpointGeneration}});
   pending.cleanup=0;await persist();
  }
  while(pending.cleanup<pending.pages){
   if(now()>=deadline)return result('partial');
   const end=Math.min(pending.cleanup+50,pending.pages);
   await Promise.all(Array.from({length:end-pending.cleanup},(_,i)=>bucket.file(pageName(pending.cleanup!+i)).delete({ignoreNotFound:true})));
   pending.cleanup=end;await persist();
  }
  await bucket.file(`price-snapshots/staging/${pending.id}/changes.sqlite`).delete({ignoreNotFound:true});
  await bucket.file(`price-snapshots/staging/${pending.id}/partial.sqlite`).delete({ignoreNotFound:true});
  delete progress.pending;await persist();return result('complete');
 }finally{
  staging?.close();if(directory)await rm(directory,{recursive:true,force:true});
  progress.leaseUntil=0;await persist();
 }
}
