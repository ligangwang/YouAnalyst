import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {getStorage} from 'firebase-admin/storage';

export const SEC_CACHE_PREFIX='sec-document-cache/v1/';
export const SEC_CACHE_RETENTION_MS=90*86400000;
export const SEC_MAX_DOCUMENT_BYTES=20*1024*1024;
export class SecDocumentSizeError extends Error {
  constructor(){super('SEC document exceeds byte limit / cache byte bounds');this.name='SecDocumentSizeError';}
}
export type CachedSecMetadata={key:string;sourceUrl:string;rawSha256:string;downloadedAt:string;completedAt?:string;contentType:string;owners:Record<string,'pending'|'complete'>;generation:string;metageneration:string;temporaryHold:boolean};
export interface SecDocumentStore{
  metadata(key:string):Promise<CachedSecMetadata|null>;
  bytes(meta:CachedSecMetadata):Promise<Buffer>;
  create(meta:Omit<CachedSecMetadata,'generation'|'metageneration'>,bytes:Buffer):Promise<boolean>;
  update(meta:CachedSecMetadata,next:CachedSecMetadata):Promise<boolean>;
  list(prefix:string):AsyncIterable<CachedSecMetadata>;
  remove(meta:CachedSecMetadata):Promise<void>;
  remember(owner:string,meta:CachedSecMetadata):Promise<void>;
  processingKeys(owner:string):Promise<string[]>;
}
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function secArchiveIdentity(value:string){
  const url=new URL(value);
  const match=url.pathname.match(/^\/Archives\/edgar\/data\/(\d{1,10})\/(\d{18})\/([A-Za-z0-9][A-Za-z0-9._-]{0,239})$/);
  if(url.origin!=='https://www.sec.gov'||url.username||url.password||url.search||url.hash||!match||match[3].includes('..'))throw new Error('Invalid SEC archive document URL');
  return {url:url.href,prefix:`${SEC_CACHE_PREFIX}${Number(match[1])}/${match[2]}/`,key:`${SEC_CACHE_PREFIX}${Number(match[1])}/${match[2]}/${match[3]}`};
}
export function secCacheOwner(kind:string,id:string){return `${kind}_${digest(id)}`;}
const missing=(error:unknown)=>(error as {code?:number})?.code===404;
const conflict=(error:unknown)=>(error as {code?:number})?.code===412;

/** Private raw objects; control metadata is never a user-facing filing URL. */
export function gcsSecDocumentStore(bucketName:string):SecDocumentStore{
  if(!bucketName||bucketName.includes('/'))throw new Error('Invalid SEC cache bucket');
  const bucket=getStorage().bucket(bucketName);
  const decode=(key:string,raw:Record<string,unknown>):CachedSecMetadata=>{
    const custom=raw.metadata as Record<string,string>|undefined;
    const owners=JSON.parse(custom?.owners??'null') as CachedSecMetadata['owners'];
    if(!custom||secArchiveIdentity(custom.sourceUrl).key!==key||! /^[a-f0-9]{64}$/.test(custom.rawSha256)
      ||!Number.isFinite(Date.parse(custom.downloadedAt))||!owners||typeof owners!=='object'||Array.isArray(owners)||Object.values(owners).some(value=>!['pending','complete'].includes(value))
      ||!raw.generation||!raw.metageneration)throw new Error('Invalid SEC cache metadata');
    return {key,sourceUrl:custom.sourceUrl,rawSha256:custom.rawSha256,downloadedAt:custom.downloadedAt,completedAt:custom.completedAt||undefined,contentType:String(raw.contentType??'application/octet-stream'),owners,generation:String(raw.generation),metageneration:String(raw.metageneration),temporaryHold:raw.temporaryHold===true};
  };
  const custom=(meta:CachedSecMetadata|Omit<CachedSecMetadata,'generation'|'metageneration'>)=>({sourceUrl:meta.sourceUrl,rawSha256:meta.rawSha256,downloadedAt:meta.downloadedAt,completedAt:meta.completedAt??'',owners:JSON.stringify(meta.owners)});
  type Provenance=Record<string,{sourceUrl:string;rawSha256:string;downloadedAt:string}>;
  const indexFile=(owner:string)=>bucket.file(`sec-document-work/v1/${owner}.json`);
  async function index(owner:string):Promise<{generation:number;files:Provenance}>{
    const file=indexFile(owner);
    try{const [raw]=await file.getMetadata();const [bytes]=await bucket.file(file.name,{generation:raw.generation}).download();
      const files=JSON.parse(bytes.toString()) as Provenance;
      if(!files||Array.isArray(files)||typeof files!=='object'||Object.keys(files).length>1000||Object.entries(files).some(([key,value])=>!value||secArchiveIdentity(value.sourceUrl).key!==key||! /^[a-f0-9]{64}$/.test(value.rawSha256)||!Number.isFinite(Date.parse(value.downloadedAt))))throw new Error('Invalid SEC processing provenance');
      return {generation:Number(raw.generation),files};
    }catch(error){if(missing(error))return {generation:0,files:{}};throw error;}
  }
  return {
    async metadata(key){try{const [raw]=await bucket.file(key).getMetadata();return decode(key,raw as Record<string,unknown>);}catch(error){if(missing(error))return null;throw error;}},
    async bytes(meta){const [bytes]=await bucket.file(meta.key,{generation:meta.generation}).download();return bytes;},
    async create(meta,bytes){try{await bucket.file(meta.key).save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:meta.contentType,cacheControl:'private, no-store',temporaryHold:true,metadata:custom(meta)}});return true;}catch(error){if(conflict(error))return false;throw error;}},
    async update(meta,next){try{await bucket.file(meta.key).setMetadata({temporaryHold:next.temporaryHold,metadata:custom(next)},{ifMetagenerationMatch:Number(meta.metageneration)});return true;}catch(error){if(conflict(error))return false;throw error;}},
    async *list(prefix){let pageToken:string|undefined;do{const [files,next]=await bucket.getFiles({prefix,autoPaginate:false,maxResults:100,pageToken});for(const file of files){const [raw]=await file.getMetadata();yield decode(file.name,raw as Record<string,unknown>);}pageToken=next?.pageToken;}while(pageToken);},
    async remove(meta){await bucket.file(meta.key).delete({ifGenerationMatch:Number(meta.generation)});},
    async remember(owner,meta){
      for(let attempt=0;attempt<8;attempt++){
        const prior=await index(owner);
        if(prior.files[meta.key]?.rawSha256===meta.rawSha256)return;
        if(prior.files[meta.key])throw new Error('SEC processing source hash changed');
        const files={...prior.files,[meta.key]:{sourceUrl:meta.sourceUrl,rawSha256:meta.rawSha256,downloadedAt:meta.downloadedAt}};
        if(Object.keys(files).length>1000)throw new Error('SEC processing provenance bound exceeded');
        try{await indexFile(owner).save(JSON.stringify(files),{resumable:false,preconditionOpts:{ifGenerationMatch:prior.generation},metadata:{contentType:'application/json',cacheControl:'private, no-store'}});return;}catch(error){if(!conflict(error))throw error;}
      }
      throw new Error('SEC processing provenance contention');
    },
    async processingKeys(owner){return Object.keys((await index(owner)).files);},
  };
}

export function createSecDocumentCache(store:SecDocumentStore,now=Date.now){
  async function change(key:string,work:(meta:CachedSecMetadata)=>CachedSecMetadata){
    for(let attempt=0;attempt<8;attempt++){
      const meta=await store.metadata(key);if(!meta)throw new Error('SEC cached document disappeared');
      const next=work(meta);if(await store.update(meta,next))return next;
    }
    throw new Error('SEC cache metadata contention; retry');
  }
  return {
    async read(url:string,owners:string[],download:()=>Promise<{bytes:Buffer;contentType:string}>){
      const {key}=secArchiveIdentity(url);
      if(!owners.length||owners.some(owner=>! /^[a-z-]+_[a-f0-9]{64}$/.test(owner)))throw new Error('Invalid SEC processing owners');
      let meta=await store.metadata(key);
      if(!meta){
        const raw=await download();
        if(raw.bytes.length>SEC_MAX_DOCUMENT_BYTES)throw new SecDocumentSizeError();
        if(!raw.bytes.length)throw new Error('SEC document is empty');
        await store.create({key,sourceUrl:url,rawSha256:digest(raw.bytes),downloadedAt:new Date(now()).toISOString(),contentType:raw.contentType,owners:Object.fromEntries(owners.map(owner=>[owner,'pending' as const])),temporaryHold:true},raw.bytes);
      }
      meta=await change(key,current=>{
        const pending={...current.owners};for(const owner of owners)pending[owner]='pending';
        const held=Object.values(pending).includes('pending');
        return {...current,owners:pending,temporaryHold:held,...(held?{completedAt:undefined}:{})};
      });
      for(const owner of owners)await store.remember(owner,meta);
      const bytes=await store.bytes(meta);
      if(bytes.length>SEC_MAX_DOCUMENT_BYTES||digest(bytes)!==meta.rawSha256)throw new Error('SEC cached document integrity mismatch');
      return {bytes,contentType:meta.contentType};
    },
    async complete(owner:string,prefix:string){
      if(!prefix.startsWith(SEC_CACHE_PREFIX))throw new Error('Invalid SEC cache scope');
      const prefixes=new Set([prefix,...(await store.processingKeys(owner)).map(key=>key.slice(0,key.lastIndexOf('/')+1))]);
      for(const scope of prefixes)for await(const meta of store.list(scope))if(meta.owners[owner])await change(meta.key,current=>{
        const owners={...current.owners,[owner]:'complete' as const},pending=Object.values(owners).includes('pending');
        return {...current,owners,temporaryHold:pending,...(!pending?{completedAt:current.completedAt??new Date(now()).toISOString()}: {})};
      });
    },
    async cleanup(options:{deadline:number;maxDeletes?:number;apply:boolean}){
      const result={scanned:0,eligible:0,deleted:0,protected:0};
      for await(const meta of store.list(SEC_CACHE_PREFIX)){
        if(now()>=options.deadline||result.deleted>=(options.maxDeletes??100))break;
        result.scanned++;
        if(meta.temporaryHold||!Object.keys(meta.owners).length||Object.values(meta.owners).some(status=>status!=='complete')){result.protected++;continue;}
        if(!meta.completedAt||!Number.isFinite(Date.parse(meta.completedAt))||now()-Math.max(Date.parse(meta.completedAt),Date.parse(meta.downloadedAt))<SEC_CACHE_RETENTION_MS)continue;
        result.eligible++;if(options.apply){await store.remove(meta);result.deleted++;}
      }
      return result;
    },
  };
}

export type SecDocumentCache=ReturnType<typeof createSecDocumentCache>;
const scope=new AsyncLocalStorage<{cache:SecDocumentCache;owner:string}>();
let configured:{bucket:string;cache:SecDocumentCache}|undefined;
export function configuredSecDocumentCache(){
  const bucket=process.env.SEC_DOCUMENT_CACHE_BUCKET;if(!bucket)return undefined;
  if(configured?.bucket!==bucket)configured={bucket,cache:createSecDocumentCache(gcsSecDocumentStore(bucket))};
  return configured.cache;
}
export function secDocumentCacheScope(){return scope.getStore();}
export async function withSecDocumentProcessing<T>(owner:string,url:string,work:()=>Promise<T>,completed:(result:T)=>boolean,cache=configuredSecDocumentCache()){
  if(!cache){if(process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED==='1')throw new Error('SEC processing requires its cache bucket');return work();}
  const {prefix}=secArchiveIdentity(url);
  const result=await scope.run({cache,owner},work);
  if(completed(result))await cache.complete(owner,prefix);
  return result;
}

export async function readSecDocumentBytes(response:Response){
  if(Number(response.headers.get('content-length'))>SEC_MAX_DOCUMENT_BYTES){await response.body?.cancel();throw new SecDocumentSizeError();}
  if(!response.body)throw new Error('SEC document is empty');
  const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>SEC_MAX_DOCUMENT_BYTES)throw new SecDocumentSizeError();chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
  return {bytes:Buffer.concat(chunks),contentType:response.headers.get('content-type')??'application/octet-stream'};
}
