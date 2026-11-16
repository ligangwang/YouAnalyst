import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {decode} from '../central-cache/codec';
import {pricePartition} from '../entity-snapshots/price-partition';
import type {Row} from '../entity-snapshots/sync';
import {compileQuery,field,type Step} from './query';
import {quote,withDuck,writePriceParquet} from './parquet';

export const ROOT='price-parquet/v1',HEAD=`${ROOT}/manifest.json`;
export type PriceFile={name:string;groups:string[];rows:number;min:string;max:string};
export type Manifest={version:1;ready:boolean;files:PriceFile[];watermark?:[number,number];cursor?:string;source?:'sqlite';sourceCursor?:number;sourceFiles?:number};
export type Head={generation:string;manifest:Manifest};
export type Mutation={id:string;data:Record<string,unknown>;mode?:'merge'|'replace'|'create'|'missing'|'delete';updateTime?:Timestamp;exists?:boolean};
const groupFor=(id:string)=>{
 const p=pricePartition(id);if(!p)throw Error('Invalid price ID');
 return `${p.market}/${p.year}/${createHash('sha256').update(p.ticker).digest('hex')[0]}`;
};
const groupPredicate=(group:string)=>{
 const [market,year,shard]=group.split('/');
 if(!/^(US|CN_A|FX)\/[0-9]{4}\/[0-9a-f]$/.test(group))throw Error('Invalid price group');
 return `market=${quote(market)} AND substr("tradingDate",1,4)=${quote(year)} AND substr(sha256(ticker),1,1)=${quote(shard)}`;
};
export async function readHead(bucket:Bucket):Promise<Head>{
 for(let attempt=0;attempt<4;attempt++){
  const file=bucket.file(HEAD);
  let generation:string;
  try{const [meta]=await file.getMetadata();generation=String(meta.generation);}
  catch(error){if((error as {code?:number}).code===404)return {generation:'0',manifest:{version:1,ready:false,files:[]}};throw error;}
  try{
   const [bytes]=await bucket.file(HEAD,{generation}).download();
   const manifest=JSON.parse(bytes.toString()) as Manifest;
   if(manifest.version!==1||!Array.isArray(manifest.files)||typeof manifest.ready!=='boolean')throw Error('Invalid price manifest');
   for(const f of manifest.files)if(!f.name.startsWith(ROOT+'/data/')||!/^price-parquet\/v1\/data\/[a-f0-9-]+\.parquet$/.test(f.name)||!Array.isArray(f.groups))throw Error('Invalid price file');
   return {generation,manifest};
  }catch(error){if((error as {code?:number}).code!==404)throw error;}
 }
 throw Error('Price manifest changed repeatedly');
}
export async function saveHead(bucket:Bucket,head:Head,manifest:Manifest){
 for(let attempt=0;;attempt++)try{
  await bucket.file(HEAD).save(JSON.stringify(manifest),{resumable:false,metadata:{contentType:'application/json',cacheControl:'private, no-store'},preconditionOpts:{ifGenerationMatch:head.generation}});break;
 }catch(error){if((error as {code?:number}).code!==429||attempt>=4)throw error;await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));}
 const {invalidatePriceHead}=await import('./runtime');invalidatePriceHead();
}

type Cached={path:string;bytes:number;users:number;ready:Promise<void>};
export class PriceStore {
 private directory=mkdtemp(join(tmpdir(),'ya-parquet-'));
 private files=new Map<string,Cached>();
 private reads:Promise<unknown>=Promise.resolve();
 private results=new Map<string,{promise:Promise<Row[]>;bytes:number}>();
 constructor(readonly bucket:Bucket,readonly cacheBytes=128*1024*1024){}
 async close(){await this.trim(true);await rm(await this.directory,{recursive:true,force:true});}
 private async trim(all=false){
  let bytes=[...this.files.values()].reduce((n,f)=>n+f.bytes,0);
  for(const [name,f] of [...this.files]){if(!all&&bytes<=this.cacheBytes)break;if(f.users||this.files.get(name)!==f)continue;this.files.delete(name);await f.ready.catch(()=>{});await rm(f.path,{force:true});bytes-=f.bytes;}
 }
 async local<T>(names:string[],work:(paths:string[])=>Promise<T>){
  const pinned:Cached[]=[];
  // Resolve the directory before looking up entries: a first-use await between
  // lookup and insertion can create two untracked pins for the same file.
  const directory=await this.directory;
  try{
   for(const name of [...new Set(names)]){
    let f=this.files.get(name);
    if(!f){
     // Eviction unlinks asynchronously. A replacement must never reuse the
     // retiring entry's path, even when it downloads before unlink completes.
     const path=join(directory,createHash('sha256').update(name).digest('hex')+'-'+randomUUID()+'.parquet');
     f={path,bytes:0,users:0,ready:Promise.resolve()};const entry=f;
     f.ready=this.bucket.file(name).download({destination:path}).then(async()=>{entry.bytes=(await stat(path)).size;});
     this.files.set(name,f);
    }
    f.users++;pinned.push(f);this.files.delete(name);this.files.set(name,f);
    try{await f.ready;}catch(error){if(this.files.get(name)===f)this.files.delete(name);await rm(f.path,{force:true});throw error;}
   }
   return await work(pinned.map(f=>f.path));
  }finally{for(const f of pinned)f.users--;await this.trim();}
 }
 async query(steps:Step[],head?:Head,includeDeleted=false):Promise<Row[]>{
  const current=head??await readHead(this.bucket),plan=compileQuery(steps);
  const key=JSON.stringify([current.generation,plan.where,plan.order,plan.limit,plan.selection,includeDeleted]);
  const cached=this.results.get(key);if(cached){this.results.delete(key);this.results.set(key,cached);return cached.promise;}
  const started=Date.now();
  const entry={promise:this.reads.then(()=>this.queryUncached(steps,current,includeDeleted)),bytes:0};
  this.reads=entry.promise.catch(()=>{});this.results.set(key,entry);
  entry.promise.then(rows=>{
   console.info(JSON.stringify({event:'price_parquet_query',rows:rows.length,durationMs:Date.now()-started,generation:current.generation,service:process.env.K_SERVICE,revision:process.env.K_REVISION,job:process.env.CLOUD_RUN_JOB}));
   entry.bytes=Buffer.byteLength(JSON.stringify(rows))*2+rows.length*256;
   let bytes=[...this.results.values()].reduce((n,e)=>n+e.bytes,0);
   for(const [k,e] of this.results){if(bytes<=32*1024*1024&&this.results.size<=1024)break;if(!e.bytes)continue;this.results.delete(k);bytes-=e.bytes;}
  },()=>{this.results.delete(key);});
  return entry.promise;
 }
 private async queryUncached(steps:Step[],current:Head,includeDeleted:boolean):Promise<Row[]>{
  if(!current.manifest.ready)throw Error('Parquet price migration is not ready');
  const plan=compileQuery(steps),files=current.manifest.files;
  const identity=compileQuery(steps.filter(s=>s.method==='where'&&['id','market','ticker','tradingDate'].includes(field(s.args[0])))).where;
  let singleInstrument=false;
  let groups=[...new Set(files.flatMap(f=>f.groups))];
  for(const step of steps.filter(s=>s.method==='where'&&field(s.args[0])==='tradingDate')){
   const year=Number(String(step.args[2]).slice(0,4));if(!Number.isInteger(year))continue;
   if(['>=','>'].includes(String(step.args[1])))groups=groups.filter(g=>Number(g.split('/')[1])>=year);
   if(['<=','<'].includes(String(step.args[1])))groups=groups.filter(g=>Number(g.split('/')[1])<=year);
   if(step.args[1]==='==')groups=groups.filter(g=>Number(g.split('/')[1])===year);
  }
  const ids=steps.find(s=>s.method==='where'&&field(s.args[0])==='id'&&['==','in'].includes(String(s.args[1])));
  if(ids){const values=ids.args[1]==='in'?ids.args[2] as string[]:[String(ids.args[2])];const wanted=new Set(values.map(groupFor));groups=groups.filter(g=>wanted.has(g));}
  const ticker=steps.find(s=>s.method==='where'&&field(s.args[0])==='ticker'&&s.args[1]==='==')?.args[2];
  if(typeof ticker==='string'){const shard=createHash('sha256').update(ticker).digest('hex')[0];groups=groups.filter(g=>g.endsWith('/'+shard));}
  const lower=steps.find(s=>s.method==='where'&&field(s.args[0])==='id'&&['>=','>'].includes(String(s.args[1])))?.args[2];
  const upper=steps.find(s=>s.method==='where'&&field(s.args[0])==='id'&&['<=','<'].includes(String(s.args[1])))?.args[2];
  if(typeof lower==='string'&&typeof upper==='string'){
   const p=pricePartition(upper),low=pricePartition(lower);
   if(p&&(lower===`${p.market}_${p.ticker}_`||low&&low.market===p.market&&low.ticker===p.ticker)){
    singleInstrument=true;
    const shard=createHash('sha256').update(p.ticker).digest('hex')[0];
    groups=groups.filter(g=>{const [market,year,s]=g.split('/');return market===p.market&&s===shard&&Number(year)<=p.year&&(!low||Number(year)>=low.year);});
   }
  }
  const yearOrder=plan.order.startsWith('"tradingDate"')||singleInstrument&&plan.order.startsWith('"id"');
  const direction=plan.order.split(',')[0].endsWith('desc')?-1:1;
  if(yearOrder)groups.sort((a,b)=>(Number(a.split('/')[1])-Number(b.split('/')[1]))*direction);
  let result:Row[]=[],lastYear:string|undefined;
  for(const group of groups){
   const year=group.split('/')[1];
   if(yearOrder&&lastYear!==undefined&&year!==lastYear&&result.length>=plan.limit)break;
   lastYear=year;
   const selected=files.filter(f=>f.groups.includes(group));
   const rows=await this.local(selected.map(f=>f.name),paths=>withDuck(async db=>{
    const union=paths.map((path,i)=>`SELECT *,${i} AS priority FROM read_parquet(${quote(path)}) WHERE ${groupPredicate(group)} AND ${identity}`).join(' UNION ALL ');
    return (await db.runAndReadAll(`WITH versions AS (${union}), latest AS (SELECT * EXCLUDE(priority) FROM versions QUALIFY row_number() OVER (PARTITION BY id ORDER BY "updatedAt" DESC,priority DESC)=1) SELECT id,payload FROM latest WHERE ${includeDeleted?'TRUE':'"isDeleted" IS NOT TRUE'} AND ${plan.where} ORDER BY ${plan.order} LIMIT ${plan.limit}`)).getRows().map(([id,payload])=>({id:String(id),data:decode(JSON.parse(String(payload)))}));
   }));
   result=[...result,...rows].sort(plan.compare).slice(0,plan.limit);
  }
  if(plan.selection)result=result.map(row=>({...row,data:Object.fromEntries(plan.selection!.filter(key=>key!=='id'&&Object.hasOwn(row.data,key)).map(key=>[key,row.data[key]]))}));
  return result;
 }
 async upload(rows:Row[]):Promise<PriceFile>{
  const name=`${ROOT}/data/${randomUUID()}.parquet`,path=join(await this.directory,randomUUID()+'.parquet');
  try{
   await writePriceParquet(path,rows);
   await this.bucket.upload(path,{destination:name,resumable:true,metadata:{contentType:'application/vnd.apache.parquet'},preconditionOpts:{ifGenerationMatch:0}});
   const ids=rows.map(r=>r.id).sort();return {name,groups:[...new Set(ids.map(groupFor))],rows:rows.length,min:ids[0],max:ids.at(-1)!};
  }finally{await rm(path,{force:true});}
 }
 async compactGroup(head:Head,group:string):Promise<PriceFile>{
  const files=head.manifest.files.filter(f=>f.groups.includes(group));
  if(!files.length)throw Error('Missing compaction group');
  const name=`${ROOT}/data/${randomUUID()}.parquet`,path=join(await this.directory,randomUUID()+'.parquet');
  try{return await this.local(files.map(f=>f.name),paths=>withDuck(async db=>{
   const union=paths.map((p,i)=>`SELECT *,${i} AS priority FROM read_parquet(${quote(p)}) WHERE ${groupPredicate(group)}`).join(' UNION ALL ');
   await db.run(`COPY (WITH versions AS (${union}) SELECT * EXCLUDE(priority) FROM versions QUALIFY row_number() OVER (PARTITION BY id ORDER BY "updatedAt" DESC,priority DESC)=1 ORDER BY id) TO ${quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 16384)`);
   const [[count,min,max]]= (await db.runAndReadAll(`SELECT count(*),min(id),max(id) FROM read_parquet(${quote(path)})`)).getRows();
   // EXCEPT ALL compares every typed column and the lossless payload, including
   // multiplicity. Compaction cannot publish a file that drops or changes rows.
   const [[difference]]= (await db.runAndReadAll(`WITH versions AS (${union}), latest AS (SELECT * EXCLUDE(priority) FROM versions QUALIFY row_number() OVER (PARTITION BY id ORDER BY "updatedAt" DESC,priority DESC)=1), differences AS ((SELECT * FROM latest EXCEPT ALL SELECT * FROM read_parquet(${quote(path)})) UNION ALL (SELECT * FROM read_parquet(${quote(path)}) EXCEPT ALL SELECT * FROM latest)) SELECT count(*) FROM differences`)).getRows();
   if(Number(difference)!==0)throw Error('Compaction parity failed');
   await this.bucket.upload(path,{destination:name,resumable:true,metadata:{contentType:'application/vnd.apache.parquet'},preconditionOpts:{ifGenerationMatch:0}});
   return {name,groups:[group],rows:Number(count),min:String(min),max:String(max)};
  }));}finally{await rm(path,{force:true});}
 }
 /** Mirror committed source rows during the additive rollout. Timestamp ordering
  * makes a delayed mirror harmless when a newer correction already exists. */
 async ingest(rows:Row[]){
  if(!rows.length)return;
  const file=await this.upload(rows);
  for(let attempt=0;attempt<8;attempt++){
   const head=await readHead(this.bucket);
   if(!head.manifest.ready)throw Error('Initial price export required');
   try{await saveHead(this.bucket,head,{...head.manifest,files:[...head.manifest.files,file]});return;}
   catch(error){if((error as {code?:number}).code!==412||attempt===7)throw error;}
  }
 }
 async mutate(changes:Mutation[]){
  if(!changes.length)return {created:0,existing:0};
  if(changes.length>1000||new Set(changes.map(c=>c.id)).size!==changes.length)throw Error('Invalid price mutation batch');
  for(let attempt=0;attempt<5;attempt++){
   const head=await readHead(this.bucket);if(!head.manifest.ready)throw Error('Parquet price migration is not ready');
   const previous=new Map((await this.query([{method:'where',args:['id','in',changes.map(c=>c.id)]},{method:'limit',args:[1000]}],head,true)).map(row=>[row.id,row.data]));
   let stamp=Timestamp.now();
   for(const data of previous.values())if(data.updatedAt instanceof Timestamp&&data.updatedAt.valueOf()>=stamp.valueOf()){
    const t=data.updatedAt;stamp=t.nanoseconds===999999999?new Timestamp(t.seconds+1,0):new Timestamp(t.seconds,t.nanoseconds+1);
   }
   let created=0,existing=0;const rows:Row[]=[];
   for(const change of changes){
    const old=previous.get(change.id);
    if(change.exists!==undefined&&change.exists!==!!old)throw Object.assign(Error('Price existence precondition failed'),{code:9});
    if(change.mode==='missing'&&old){existing++;continue;}
    if(change.mode==='create'&&old)throw Object.assign(Error('Price already exists'),{code:6});
    if(change.updateTime&&(!(old?.updatedAt instanceof Timestamp)||!old.updatedAt.isEqual(change.updateTime)))throw Object.assign(Error('Price changed'),{code:9});
    if(change.mode==='delete'&&!old)continue;
    const data={...(change.mode==='replace'?{}:old),...change.data,updatedAt:stamp};
    if(change.mode==='delete')Object.assign(data,{isDeleted:true,deletedAt:old?.deletedAt??stamp});
    else if(old?.isDeleted===true&&change.data.isDeleted!==false)Object.assign(data,{isDeleted:true,deletedAt:old.deletedAt??old.updatedAt});
    else if(change.data.isDeleted===false)delete (data as Record<string,unknown>).deletedAt;
    rows.push({id:change.id,data});if(!old)created++;
   }
   if(!rows.length)return {created,existing};
   const file=await this.upload(rows);
   try{await saveHead(this.bucket,head,{...head.manifest,files:[...head.manifest.files,file]});}
   catch(error){if((error as {code?:number}).code!==412||attempt===4)throw error;continue;}
   return {created,existing};
  }
  throw Error('Price publication conflict');
 }
}
