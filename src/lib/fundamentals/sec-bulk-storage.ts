import type {Bucket} from '@google-cloud/storage';
import {createHash} from 'node:crypto';
import {SEC_BULK_PREFIX,validateSecBulkSnapshot,type SecBulkKind,type SecBulkReader,type SecBulkSnapshot} from './sec-bulk';

export const SEC_BULK_MAX_JSON=128*1024*1024;
export const secBulkSnapshotPrefix=(id:string)=>`${SEC_BULK_PREFIX}snapshots/${id}/`;
const missing=(error:unknown)=>Number((error as {code?:unknown})?.code)===404;
export function createSecBulkReader(bucket:Bucket):SecBulkReader{
  return {
    async latest(){
      try{
        const file=bucket.file(`${SEC_BULK_PREFIX}latest.json`),[metadata]=await file.getMetadata();
        if(!metadata.generation||!Number.isFinite(Number(metadata.size))||Number(metadata.size)>1024*1024)throw Error('SEC bulk manifest too large');
        const [bytes]=await bucket.file(file.name,{generation:metadata.generation}).download();
        if(bytes.length>1024*1024)throw Error('SEC bulk manifest too large');
        return validateSecBulkSnapshot(JSON.parse(bytes.toString('utf8')));
      }catch(error){if(missing(error))return null;throw error;}
    },
    async read(snapshot,kind,cik){
      validateSecBulkSnapshot(snapshot);
      if(!snapshot.ciks.includes(cik)||!['companyfacts','submissions'].includes(kind))throw Error('Issuer outside SEC bulk snapshot');
      const file=bucket.file(`${secBulkSnapshotPrefix(snapshot.id)}${kind}/CIK${cik}.json`);
      try{
        const [metadata]=await file.getMetadata();
        if(!metadata.generation||!Number.isFinite(Number(metadata.size))||Number(metadata.size)<=0||Number(metadata.size)>SEC_BULK_MAX_JSON)throw Error('SEC bulk company JSON exceeds supported size');
        const [bytes]=await bucket.file(file.name,{generation:metadata.generation}).download();
        if(bytes.length>SEC_BULK_MAX_JSON)throw Error('SEC bulk company JSON exceeds supported size');
        if(metadata.metadata?.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('SEC bulk company JSON integrity mismatch');
        return JSON.parse(bytes.toString('utf8'));
      }catch(error){if(missing(error))return null;throw error;}
    },
  };
}

/** Pointer publication is last and conditional; incomplete extraction is invisible. */
export async function publishSecBulkSnapshot(bucket:Bucket,snapshot:SecBulkSnapshot,expectedGeneration:string|number){
  validateSecBulkSnapshot(snapshot);
  const existing=await createSecBulkReader(bucket).latest();
  if(existing&&JSON.stringify(existing)===JSON.stringify(snapshot))return;
  if(existing&&Date.parse(existing.capturedAt)>Date.parse(snapshot.capturedAt))throw Error('Refusing older SEC bulk publication');
  await bucket.file(`${secBulkSnapshotPrefix(snapshot.id)}manifest.json`).save(JSON.stringify(snapshot),{
    resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/json',cacheControl:'private, no-store'},
  }).catch(async error=>{
    if(Number((error as {code?:unknown})?.code)!==412)throw error;
    const [bytes]=await bucket.file(`${secBulkSnapshotPrefix(snapshot.id)}manifest.json`).download();
    if(bytes.toString('utf8')!==JSON.stringify(snapshot))throw Error('SEC bulk snapshot identity reused');
  });
  // A concurrent publisher must not replace a newer snapshot with an older one.
  await bucket.file(`${SEC_BULK_PREFIX}latest.json`).save(JSON.stringify(snapshot),{
    resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:expectedGeneration},metadata:{contentType:'application/json',cacheControl:'private, no-store'},
  });
}

export async function saveSecBulkCompany(bucket:Bucket,snapshot:SecBulkSnapshot,kind:SecBulkKind,cik:string,bytes:Buffer){
  validateSecBulkSnapshot(snapshot);
  if(!snapshot.ciks.includes(cik)||!['companyfacts','submissions'].includes(kind))throw Error('Issuer outside SEC bulk snapshot');
  if(bytes.length>SEC_BULK_MAX_JSON)throw Error('SEC bulk company JSON exceeds supported size');
  const value=JSON.parse(bytes.toString('utf8'));
  if(!value||!/^\d{1,10}$/.test(String(value.cik))||String(value.cik).padStart(10,'0')!==cik)throw Error('SEC bulk issuer identity mismatch');
  const file=bucket.file(`${secBulkSnapshotPrefix(snapshot.id)}${kind}/CIK${cik}.json`),sha256=createHash('sha256').update(bytes).digest('hex');
  await file.save(bytes,{
    resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/json',cacheControl:'private, max-age=31536000, immutable',metadata:{sha256:createHash('sha256').update(bytes).digest('hex')}},
  }).catch(async error=>{
    if(Number((error as {code?:unknown})?.code)!==412)throw error;
    const [metadata]=await file.getMetadata();
    if(metadata.metadata?.sha256!==sha256)throw Error('SEC bulk company input changed during retry');
  });
}
