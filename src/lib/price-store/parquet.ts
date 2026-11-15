import {DuckDBInstance, type DuckDBConnection} from '@duckdb/node-api';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import {pricePartition} from '../entity-snapshots/price-partition';
import type {Row} from '../entity-snapshots/sync';

export const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
export const priceColumns={id:'VARCHAR',market:'VARCHAR',ticker:'VARCHAR',tradingDate:'VARCHAR',
 close:'DOUBLE',rawClose:'DOUBLE',open:'DOUBLE',high:'DOUBLE',low:'DOUBLE',volume:'DOUBLE',
 isFinal:'BOOLEAN',isDeleted:'BOOLEAN',updatedAt:'BIGINT',payload:'VARCHAR'} as const;
export const timestampNanos=(value:Timestamp)=>BigInt(value.seconds)*BigInt(1_000_000_000)+BigInt(value.nanoseconds);
let tail:Promise<unknown>=Promise.resolve();
export function withDuck<T>(work:(connection:DuckDBConnection)=>Promise<T>):Promise<T>{
 const result=tail.then(()=>runDuck(work));tail=result.catch(()=>{});return result;
}
async function runDuck<T>(work:(connection:DuckDBConnection)=>Promise<T>):Promise<T>{
 const instance=await DuckDBInstance.create(':memory:',{threads:'1',memory_limit:'192MB',max_temp_directory_size:'0B',enable_external_access:'true'});
 const connection=await instance.connect();
 try{return await work(connection);}finally{connection.closeSync();instance.closeSync();}
}
export async function writePriceParquet(path:string,rows:Row[]){
 if(!rows.length)throw Error('Empty price file');
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Duplicate price IDs');
 await withDuck(async db=>{
  await db.run(`CREATE TABLE prices (${Object.entries(priceColumns).map(([key,type])=>`"${key}" ${type}`).join(',')})`);
  const append=await db.createAppender('prices');
  try{for(const {id,data} of rows){
   const part=pricePartition(id);if(!part||!(data.updatedAt instanceof Timestamp))throw Error('Invalid price identity/timestamp');
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
