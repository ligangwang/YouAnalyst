import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DuckDBConnection} from '@duckdb/node-api';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import {pricePartition} from '../entity-snapshots/price-partition';
import type {Row} from '../entity-snapshots/sync';
import {startMarketReadTiming} from '../market-read-timing';

export const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
export const priceColumns={id:'VARCHAR',market:'VARCHAR',ticker:'VARCHAR',tradingDate:'VARCHAR',
 close:'DOUBLE',rawClose:'DOUBLE',open:'DOUBLE',high:'DOUBLE',low:'DOUBLE',volume:'DOUBLE',
 isFinal:'BOOLEAN',isDeleted:'BOOLEAN',updatedAt:'BIGINT',payload:'VARCHAR'} as const;
export const timestampNanos=(value:Timestamp)=>BigInt(value.seconds)*BigInt(1_000_000_000)+BigInt(value.nanoseconds);
type DuckQueue = {busy:boolean; page:Array<()=>void>; other:Array<()=>void>; consecutivePage:number};
declare global {
 var __youAnalystDuckScheduler:DuckQueue|undefined;
 var __youAnalystPageProjection:AsyncLocalStorage<true>|undefined;
}
const queue=globalThis.__youAnalystDuckScheduler??={busy:false,page:[],other:[],consecutivePage:0};
const pageProjection=globalThis.__youAnalystPageProjection??=new AsyncLocalStorage<true>();
export const withPageProjection=<T>(work:()=>Promise<T>)=>pageProjection.run(true,work);

function admitDuck():Promise<void>{
 if(!queue.busy){queue.busy=true;return Promise.resolve();}
 return new Promise(resolve=>(pageProjection.getStore()?queue.page:queue.other).push(resolve));
}
function releaseDuck(){
 // Keep a single native instance and give queued bulk work a turn after three page reads.
 if(queue.page.length&&(!queue.other.length||queue.consecutivePage<3)){
  queue.consecutivePage++;queue.page.shift()!();return;
 }
 queue.consecutivePage=0;
 const next=queue.other.shift();
 if(next)next();else queue.busy=false;
}
export async function withDuck<T>(work:(connection:DuckDBConnection)=>Promise<T>):Promise<T>{
 const timing=startMarketReadTiming('duckdb');
 await admitDuck();
 let status:'success'|'error'='error';
 try{timing?.workStarted();const value=await runDuck(work);status='success';return value;}
 finally{releaseDuck();timing?.finish(status);}
}
async function runDuck<T>(work:(connection:DuckDBConnection)=>Promise<T>):Promise<T>{
 const {DuckDBInstance}=await import('@duckdb/node-api');
 const memory=Number(process.env.PRICE_DUCKDB_MEMORY_MB??192);
 if(!Number.isInteger(memory)||memory<64||memory>1024)throw Error('Invalid DuckDB memory budget');
 // Cloud Run's application directory is read-only. Bound scratch space in its
 // writable temporary filesystem and remove it after each serialized operation.
 const scratch=await mkdtemp(join(tmpdir(),'youanalyst-duck-'));
 try{
  const instance=await DuckDBInstance.create(':memory:',{threads:'1',memory_limit:`${memory}MB`,temp_directory:scratch,max_temp_directory_size:'256MB',enable_external_access:'true'});
  try{
   const connection=await instance.connect();
   try{return await work(connection);}finally{connection.closeSync();}
  }finally{instance.closeSync();}
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function writePriceParquet(path:string,rows:Row[]){
 if(!rows.length)throw Error('Empty price file');
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Duplicate price IDs');
 await withDuck(async db=>{
  await db.run(`CREATE TABLE prices (${Object.entries(priceColumns).map(([key,type])=>`"${key}" ${type}`).join(',')})`);
  const append=await db.createAppender('prices');
  try{for(const {id,data} of rows){
   const part=pricePartition(id);if(!part||!(data.updatedAt instanceof Timestamp))throw Error('Invalid price identity/timestamp');
   if(data.market!==part.market||data.ticker!==part.ticker||data.tradingDate!==id.slice(-10))throw Error('Price fields disagree with document identity');
   const values:Record<string,unknown>={...data,id,market:part.market,ticker:part.ticker,tradingDate:id.slice(-10),
    updatedAt:timestampNanos(data.updatedAt),isDeleted:data.isDeleted===true,payload:JSON.stringify(encode(data))};
   for(const [key,type] of Object.entries(priceColumns)){
    const value=values[key];
    if(value===undefined||value===null)append.appendNull();
    else if(type==='VARCHAR')append.appendVarchar(String(value));
    else if(type==='BIGINT')append.appendBigInt(value as bigint);
    else if(type==='BOOLEAN'){if(typeof value!=='boolean')throw Error(`Invalid ${key}`);append.appendBoolean(value);}
    else {if(typeof value!=='number'||!Number.isFinite(value))throw Error(`Invalid ${key}`);append.appendDouble(value);}
   }
   append.endRow();
  }}finally{append.closeSync();}
  await db.run(`COPY (SELECT * FROM prices ORDER BY id) TO ${quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 16384)`);
  const check=await db.runAndReadAll(`SELECT count(*) FROM read_parquet(${quote(path)})`);
  if(Number(check.getRows()[0][0])!==rows.length)throw Error('Parquet row count mismatch');
 });
}
export async function readPriceParquet(path:string):Promise<Row[]>{
 return withDuck(async db=>(await db.runAndReadAll(`SELECT id,payload FROM read_parquet(${quote(path)}) ORDER BY id`))
  .getRows().map(([id,payload])=>({id:String(id),data:decode(JSON.parse(String(payload)))})));
}
