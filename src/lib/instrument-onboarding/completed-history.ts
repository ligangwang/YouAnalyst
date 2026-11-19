import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage,type Bucket} from '@google-cloud/storage';
import type {DocumentData,Firestore,Transaction} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import {PriceStore} from '../price-store/storage';
import {withDuck,quote} from '../price-store/parquet';
import {validInstrumentId} from '../instruments/model';

export const HISTORY_CONTROL='collectors/_instrument_onboarding_history';
const prefix='market-parquet/v1/private/instrument-onboarding-history';
const partitions='0123456789abcdef';
type Catalog={version:1;files:Record<string,string>};
type Entry={id:string;data:DocumentData};
function validateCatalog(value:DocumentData|undefined):Catalog|undefined{
  if(!value)return undefined;
  if(value.version!==1||!value.files||Object.keys(value.files).length!==16)throw Error('Incomplete onboarding history catalog');
  for(const shard of partitions){
    const key=value.files[shard];
    if(typeof key!=='string'||!key.startsWith(prefix+'/'+shard+'/')||!/^[-0-9a-f]{36}\.parquet$/.test(key.slice((prefix+'/'+shard+'/').length)))throw Error('Invalid onboarding history file');
  }
  return value as Catalog;
}
/** Private completed receipts. Contiguous ID partitions preserve native admin cursor order. */
export class CompletedRequestFiles{
  private readonly cache:PriceStore;
  constructor(private readonly bucket:Bucket){this.cache=new PriceStore(bucket,8*1024*1024);}
  async read(file:string,filter:{id?:string;after?:string;limit?:number}={}):Promise<Entry[]>{
    return this.cache.local([file],([path])=>withDuck(async db=>{
      const where=filter.id?' WHERE id='+quote(filter.id):filter.after?' WHERE id>'+quote(filter.after):'';
      const rows=await db.runAndReadAll('SELECT id,payload FROM read_parquet('+quote(path)+')'+where+' ORDER BY id'+(filter.limit===undefined?'':' LIMIT '+Number(filter.limit)));
      return rows.getRows().map(([id,payload])=>({id:String(id),data:decode(JSON.parse(String(payload)))}));
    }));
  }
  async write(shard:string,rows:Entry[]):Promise<string>{
    if(shard.length!==1||!partitions.includes(shard)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Invalid onboarding history partition');
    const directory=await mkdtemp(join(tmpdir(),'onboarding-history-')),path=join(directory,'receipts.parquet');
    try{
      await withDuck(async db=>{
        await db.run('CREATE TABLE receipts(id VARCHAR,payload VARCHAR)');
        const writer=await db.createAppender('receipts');
        try{for(const {id,data} of rows){
          if(!validInstrumentId(id)||id[4]!==shard||data.instrumentId!==id||data.status!=='SUPPORTED'||data.lastError!=null||data.leaseOwner!=null||data.leaseExpiresAt!==0)throw Error('Expected a completed, unlocked instrument request');
          writer.appendVarchar(id);writer.appendVarchar(JSON.stringify(encode(data)));writer.endRow();
        }}finally{writer.closeSync();}
        await db.run('COPY (SELECT * FROM receipts ORDER BY id) TO '+quote(path)+' (FORMAT PARQUET, COMPRESSION ZSTD)');
      });
      const name=prefix+'/'+shard+'/'+randomUUID()+'.parquet';
      await this.bucket.upload(path,{destination:name,resumable:false,preconditionOpts:{ifGenerationMatch:0}});return name;
    }finally{await rm(directory,{recursive:true,force:true});}
  }
  close(){return this.cache.close();}
}

let store:CompletedRequestFiles|undefined;
function historyFiles(){
  const bucket=process.env.EODHD_BULK_EOD_BUCKET||process.env.ENTITY_SNAPSHOT_BUCKET;
  if(!bucket)throw Error('Private onboarding history bucket required');
  return store??=new CompletedRequestFiles(new Storage().bucket(bucket));
}
export function usesHistoryCatalog(){
  return [process.env.GCP_PROJECT_ID,process.env.GOOGLE_CLOUD_PROJECT,process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID].includes('ifindata-80905')||Boolean(process.env.EODHD_BULK_EOD_BUCKET||process.env.ENTITY_SNAPSHOT_BUCKET);
}
export async function completedCatalog(db:Firestore,tx?:Transaction){
  if(!usesHistoryCatalog())return undefined;
  const ref=db.doc(HISTORY_CONTROL),snap=await(tx?tx.get(ref):ref.get());
  return validateCatalog(snap.data());
}
export async function completedRequest(db:Firestore,tx:Transaction,id:string){
  const catalog=await completedCatalog(db,tx);
  return catalog?(await historyFiles().read(catalog.files[id[4]],{id}))[0]?.data:undefined;
}
export async function completedPage(catalog:Catalog,cursor:string|undefined,limit:number){
  const rows:Entry[]=[];
  for(const shard of partitions){
    if(cursor&&shard<cursor[4])continue;
    rows.push(...await historyFiles().read(catalog.files[shard],{after:cursor,limit:limit-rows.length}));
    if(rows.length===limit)break;
  }
  return rows;
}
/** Publish a new immutable file and retire the queue entry in the same Firestore commit. */
export async function archiveCompletion(db:Firestore,tx:Transaction,entry:Entry){
  const catalog=await completedCatalog(db,tx);
  if(!catalog)return false;
  const shard=entry.id[4],files=historyFiles(),rows=await files.read(catalog.files[shard]);
  const next=await files.write(shard,[...rows.filter(row=>row.id!==entry.id),entry]);
  tx.update(db.doc(HISTORY_CONTROL),{['files.'+shard]:next});
  return true;
}
