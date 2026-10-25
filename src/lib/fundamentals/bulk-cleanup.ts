import type {Bucket,FileMetadata} from '@google-cloud/storage';
import type {Firestore} from 'firebase-admin/firestore';
import {FieldValue} from 'firebase-admin/firestore';
import {randomUUID} from 'node:crypto';
import {cleanExpiredBulkObjects,isRetainedBulkObject,type BulkObject} from './bulk-retention';
import {SEC_BULK_PREFIX} from './sec-bulk';
import {createSecBulkReader,secBulkSnapshotPrefix} from './sec-bulk-storage';

async function metadata(bucket:Bucket,name:string):Promise<FileMetadata|null>{try{return (await bucket.file(name).getMetadata())[0];}catch(error){if(Number((error as {code?:unknown})?.code)===404)return null;throw error;}}
async function objects(bucket:Bucket,prefix:string,deadline:number){
  const rows:BulkObject[]=[];let pageToken:string|undefined;
  for(let page=0;page<20;page++){
    if(Date.now()>=deadline)break;
    const [files,next]=await bucket.getFiles({prefix,maxResults:250,autoPaginate:false,pageToken});
    for(const file of files){const m=file.metadata;if(isRetainedBulkObject(file.name))rows.push({name:file.name,generation:String(m.generation??''),timeCreated:String(m.timeCreated??''),temporaryHold:Boolean(m.temporaryHold),eventBasedHold:Boolean(m.eventBasedHold)});}
    pageToken=next?.pageToken;if(!pageToken)break;
  }
  return {rows,capped:Boolean(pageToken)};
}
async function remove(bucket:Bucket,object:BulkObject){
  const current=await metadata(bucket,object.name);
  if(!current||current.generation!==object.generation||current.temporaryHold||current.eventBasedHold)return false;
  try{await bucket.file(object.name).delete({ifGenerationMatch:object.generation,ifMetagenerationMatch:Number(current.metageneration)});return true;}
  catch(error){const code=Number((error as {code?:unknown})?.code);if(code===404||code===412)return false;if(code===403){const latest=await metadata(bucket,object.name);if(latest?.temporaryHold||latest?.eventBasedHold)return false;}throw error;}
}
export async function cleanSecBulkFiles(bucket:Bucket,options:{apply:boolean;now?:number;limit?:number}){
  const deadline=Date.now()+30_000;
  const latest=await createSecBulkReader(bucket).latest(),protectedPrefix=latest?secBulkSnapshotPrefix(latest.id):null;
  const scan=await objects(bucket,`${SEC_BULK_PREFIX}snapshots/`,deadline),protectedNames=new Set(scan.rows.filter(o=>protectedPrefix&&o.name.startsWith(protectedPrefix)).map(o=>o.name));
  const result=await cleanExpiredBulkObjects({objects:scan.rows,protectedNames,now:options.now,limit:options.limit??100,
    stillProtected:async object=>{
      if(!options.apply||Date.now()>=deadline)return true;
      const prefix=object.name.slice(0,object.name.indexOf('/',`${SEC_BULK_PREFIX}snapshots/`.length)+1);
      const current=await createSecBulkReader(bucket).latest();
      if(current&&object.name.startsWith(secBulkSnapshotPrefix(current.id)))return true;
      const producer=await metadata(bucket,`${prefix}companyfacts.zip`);
      return Boolean(producer?.temporaryHold||producer?.eventBasedHold);
    },removeGeneration:object=>Date.now()>=deadline?Promise.resolve(false):remove(bucket,object)});
  return {...result,scanned:scan.rows.length,capped:scan.capped,apply:options.apply};
}

/** Existing EOD leases exclude both legacy readers and new asynchronous plans. */
export async function cleanEodBulkFiles(db:Firestore,bucket:Bucket,options:{apply:boolean;now?:number;limit?:number}){
  if(!options.apply)return {deleted:0,held:0,skipped:true,reason:'read-only'};
  const owner=`bulk-cleanup-${randomUUID()}`,refs=['_company_pipeline','_queue_US','_queue_CN_A','_active_US','_active_CN_A'].map(id=>db.collection('eod_runs').doc(id));
  const expires=Date.now()+5*60_000,deadline=Date.now()+30_000;
  const locked=await db.runTransaction(async tx=>{
    const state=await tx.getAll(...refs);
    if(state[0].get('activeRequest')||state.some(s=>Number(s.get('leaseExpiresAtMs'))>Date.now()))return false;
    for(const ref of refs)tx.set(ref,{leaseOwner:owner,leaseExpiresAtMs:expires},{merge:true});return true;
  });
  if(!locked)return {deleted:0,held:0,skipped:true,reason:'active EOD processing'};
  try{
    const scan=await objects(bucket,'eodhd-bulk-eod/',deadline);
    const result=await cleanExpiredBulkObjects({objects:scan.rows,protectedNames:new Set(),now:options.now,limit:options.limit??100,
      stillProtected:async()=>Date.now()>=deadline||(await refs[0].get()).get('leaseOwner')!==owner,
      removeGeneration:object=>Date.now()>=deadline?Promise.resolve(false):remove(bucket,object)});
    return {...result,scanned:scan.rows.length,capped:scan.capped,apply:true};
  }finally{
    await db.runTransaction(async tx=>{const state=await tx.getAll(...refs);for(let i=0;i<refs.length;i++)if(state[i].get('leaseOwner')===owner)tx.set(refs[i],{leaseOwner:FieldValue.delete(),leaseExpiresAtMs:FieldValue.delete()},{merge:true});});
  }
}
