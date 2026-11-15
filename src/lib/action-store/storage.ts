import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Bucket} from '@google-cloud/storage';
import {encode,decode} from '../central-cache/codec';
import {quote,withDuck} from '../price-store/parquet';
import {PriceStore} from '../price-store/storage';
import type {Row} from '../entity-snapshots/sync';

export const ACTION_ROOT='corporate-actions-parquet/v1';
export const actionShard=(ticker:string)=>createHash('sha256').update(ticker).digest('hex').slice(0,2);
type Head={generation:string;file?:string};
export interface ActionRepository {
 readTicker(ticker:string):Promise<Row[]>;
 mergeTicker(ticker:string,rows:Row[]):Promise<void>;
}
function validate(row:Row){
 const d=row.data;
 if(typeof d.ticker!=='string'||!d.ticker||!['US','CN_A'].includes(d.market)||!['split','dividend'].includes(d.type)
  ||!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate)||row.id!==`${d.market}_${d.ticker}_${d.type}_${d.effectiveDate}`
  ||typeof d.updatedAt!=='string'||!Number.isFinite(Date.parse(d.updatedAt)))throw Error('Invalid corporate action identity or timestamp');
}
export function mergeActionFields(a:Record<string,unknown>,b:Record<string,unknown>):Record<string,unknown>{
 const result={...a};for(const [key,value] of Object.entries(b)){
  result[key]=value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length
   ?mergeActionFields(result[key]&&Object.getPrototypeOf(result[key])===Object.prototype?result[key] as Record<string,unknown>:{},value as Record<string,unknown>):value;
 }return result;
}
/** Immutable Parquet shards plus a generation-conditional GCS pointer. A failed
 * CAS never loses another writer's records; readers pin an immutable object. */
export class ActionStore implements ActionRepository {
 private files:PriceStore;
 private heads=new Map<string,{until:number;value:Promise<Head>}>();
 private results=new Map<string,{rows:Row[];bytes:number}>();
 private ready?:{until:number;value:Promise<boolean>};
 constructor(readonly bucket:Bucket){this.files=new PriceStore(bucket,32*1024*1024);}
 async close(){await this.files.close();}
 async isReady(){
  if(!this.ready||this.ready.until<Date.now()){
   const value=this.bucket.file(`${ACTION_ROOT}/ready.json`).download().then(([bytes])=>{
    const ready=JSON.parse(bytes.toString()).ready;
    if(typeof ready!=='boolean')throw Error('Invalid action migration state');return ready;
   });this.ready={until:Date.now()+1000,value};value.catch(()=>{this.ready=undefined;});
  }return this.ready.value;
 }
 private async assertReady(){if(!await this.isReady())throw Error('Corporate action migration is not ready');}
 private async head(shard:string,cached=false):Promise<Head>{
  if(!/^[0-9a-f]{2}$/.test(shard))throw Error('Invalid action shard');
  const old=this.heads.get(shard);if(cached&&old&&old.until>Date.now())return old.value;
  const value=(async()=>{
   const file=this.bucket.file(`${ACTION_ROOT}/heads/${shard}.json`);
   for(let i=0;i<4;i++){
    let generation:string;
    try{const [meta]=await file.getMetadata();generation=String(meta.generation);}
    catch(e){if(Number((e as {code?:number}).code)===404)return {generation:'0'};throw e;}
    try{const [bytes]=await this.bucket.file(file.name,{generation}).download();const data=JSON.parse(bytes.toString());
     if(typeof data.file!=='string'||!new RegExp(`^${ACTION_ROOT}/data/${shard}-[a-f0-9-]+\\.parquet$`).test(data.file))throw Error('Invalid action shard pointer');
     return {generation,file:data.file};
    }catch(e){if(Number((e as {code?:number}).code)!==404)throw e;}
   }throw Error('Action shard changed repeatedly');
  })();this.heads.set(shard,{until:Date.now()+1000,value});value.catch(()=>this.heads.delete(shard));return value;
 }
 private async rows(head:Head,ticker?:string):Promise<Row[]>{
  if(!head.file)return [];
  const key=`${head.file}:${ticker??'*'}`,cached=this.results.get(key);if(cached)return cached.rows.map(r=>({id:r.id,data:decode(encode(r.data))}));
  const rows=await this.files.local([head.file],paths=>withDuck(async db=>(await db.runAndReadAll(
   `SELECT id,payload FROM read_parquet(${quote(paths[0])}) ${ticker===undefined?'':`WHERE ticker=${quote(ticker)}`} ORDER BY id`
  )).getRows().map(([id,payload])=>({id:String(id),data:decode(JSON.parse(String(payload)))}))));
  const bytes=Buffer.byteLength(JSON.stringify(rows))*2;this.results.set(key,{rows,bytes});
  let size=[...this.results.values()].reduce((n,e)=>n+e.bytes,0);
  for(const [k,e] of this.results){if(size<=16*1024*1024&&this.results.size<=512)break;this.results.delete(k);size-=e.bytes;}
  return rows.map(r=>({id:r.id,data:decode(encode(r.data))}));
 }
 async readTicker(ticker:string){await this.assertReady();return this.rows(await this.head(actionShard(ticker),true),ticker);}
 async readShard(shard:string){return this.rows(await this.head(shard));}
 async mergeTicker(ticker:string,rows:Row[]){
  await this.assertReady();await this.updateShard(actionShard(ticker),rows,ticker);
 }
 async stageTicker(ticker:string,rows:Row[]){await this.updateShard(actionShard(ticker),rows,ticker);}
 /** Operator import preserves newer production corrections during cutover. */
 async importShard(shard:string,rows:Row[]){for(const row of rows)validate(row);await this.updateShard(shard,rows);}
 private async updateShard(shard:string,changes:Row[],ticker?:string){
  if(!changes.length)return;
  if(new Set(changes.map(r=>r.id)).size!==changes.length)throw Error('Duplicate action mutation');
  for(let attempt=0;attempt<12;attempt++){
   const head=await this.head(shard),current=await this.rows(head),byId=new Map(current.map(r=>[r.id,r]));
   for(const row of changes){const old=byId.get(row.id),data=mergeActionFields(old?.data??{},row.data),next={id:row.id,data};validate(next);
    if(actionShard(String(data.ticker))!==shard||(ticker!==undefined&&data.ticker!==ticker))throw Error('Action shard mismatch');
    if(old&&Date.parse(old.data.updatedAt)>Date.parse(String(data.updatedAt)))continue;
    byId.set(row.id,next);
   }
   const rows=[...byId.values()].sort((a,b)=>a.id<b.id?-1:1);
   if(JSON.stringify(encode(rows))===JSON.stringify(encode(current)))return;
   const dir=await mkdtemp(join(tmpdir(),'ya-actions-')),path=join(dir,'data.parquet');
   const name=`${ACTION_ROOT}/data/${shard}-${randomUUID()}.parquet`;
   try{
    await withDuck(async db=>{
     await db.run('CREATE TABLE actions (id VARCHAR, ticker VARCHAR, payload VARCHAR)');const append=await db.createAppender('actions');
     try{for(const r of rows){append.appendVarchar(r.id);append.appendVarchar(r.data.ticker);append.appendVarchar(JSON.stringify(encode(r.data)));append.endRow();}}finally{append.closeSync();}
     await db.run(`COPY actions TO ${quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
     const actual=(await db.runAndReadAll(`SELECT id,ticker,payload FROM read_parquet(${quote(path)}) ORDER BY id`)).getRows();
     if(actual.length!==rows.length||actual.some(([id,t,payload],i)=>id!==rows[i].id||t!==rows[i].data.ticker||payload!==JSON.stringify(encode(rows[i].data))))throw Error('Action Parquet roundtrip failed');
    });
    await this.bucket.upload(path,{destination:name,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}});
    await this.bucket.file(`${ACTION_ROOT}/heads/${shard}.json`).save(JSON.stringify({file:name}),{resumable:false,preconditionOpts:{ifGenerationMatch:head.generation},metadata:{contentType:'application/json',cacheControl:'private, no-store'}});
    this.heads.delete(shard);return;
   }catch(e){const code=Number((e as {code?:number}).code);if(![412,429].includes(code)||attempt===11)throw e;
    await new Promise(resolve=>setTimeout(resolve,Math.min(4000,250*2**attempt)));
   }finally{await rm(dir,{recursive:true,force:true});}
  }
 }
}
