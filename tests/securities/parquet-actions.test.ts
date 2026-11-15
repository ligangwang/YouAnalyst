import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {ActionStore,ACTION_ROOT,actionShard} from '../../src/lib/action-store/storage';

function fixture(){
 let sequence=0;const objects=new Map<string,{generation:string;bytes:Buffer}>();let conflicts=0;
 const fail=(code:number)=>Object.assign(Error(String(code)),{code});
 const bucket={file:(name:string,pinned?:{generation:string})=>({name,
  getMetadata:async()=>{const row=objects.get(name);if(!row)throw fail(404);return [{generation:row.generation}];},
  download:async(options?:{destination:string})=>{const row=objects.get(name);if(!row||pinned&&row.generation!==pinned.generation)throw fail(404);if(options)await writeFile(options.destination,row.bytes);return [row.bytes];},
  save:async(bytes:string,options:{preconditionOpts:{ifGenerationMatch:string}})=>{
   if((objects.get(name)?.generation??'0')!==String(options.preconditionOpts.ifGenerationMatch)){conflicts++;throw fail(412);}
   objects.set(name,{generation:String(++sequence),bytes:Buffer.from(bytes)});
  },
 }),upload:async(path:string,options:{destination:string})=>{objects.set(options.destination,{generation:String(++sequence),bytes:await readFile(path)});}} as unknown as Bucket;
 const ready=()=>objects.set(`${ACTION_ROOT}/ready.json`,{generation:String(++sequence),bytes:Buffer.from('{"ready":true}')});
 return {objects,bucket,store:new ActionStore(bucket),ready,conflicts:()=>conflicts};
}
const row=(day:string,factor=2,updatedAt='2026-11-15T12:00:00.000Z')=>({id:`US_NVDA_split_${day}`,data:{ticker:'NVDA',market:'US',type:'split',effectiveDate:day,status:'completed',splitFactor:factor,updatedAt,createdAt:'original',sourcePayload:{split:`${factor}/1`,nullable:null,bytes:Buffer.from('test'),timestamp:new Timestamp(10,123)}}});

test('migration fails closed until ready and preserves every field through real DuckDB/Parquet',async()=>{
 const f=fixture();try{
  await assert.rejects(f.store.readTicker('NVDA'));
  const rows=[row('2024-06-10'),row('2021-07-20',4)];await f.store.importShard(actionShard('NVDA'),rows);f.ready();
  assert.deepEqual(await f.store.readTicker('NVDA'),rows.toSorted((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual(await f.store.readTicker('UNKNOWN'),[]);
  const mutated=await f.store.readTicker('NVDA');mutated[0].data.createdAt='changed';
  assert.equal((await f.store.readTicker('NVDA'))[0].data.createdAt,'original');
 }finally{await f.store.close();}
});
test('concurrent updates preserve both records, cancellations and creation metadata; stale imports cannot undo corrections',async()=>{
 const f=fixture(),second=new ActionStore(f.bucket);try{
  await f.store.importShard(actionShard('NVDA'),[row('2021-07-20'),row('2024-06-10')]);f.ready();
  await Promise.all([f.store.mergeTicker('NVDA',[{id:row('2021-07-20').id,data:{status:'cancelled',updatedAt:'2026-11-15T13:00:00Z'}}]),
   second.mergeTicker('NVDA',[{id:row('2024-06-10').id,data:{splitFactor:10,updatedAt:'2026-11-15T13:00:00Z'}}])]);
  assert(f.conflicts()>0);
  await f.store.importShard(actionShard('NVDA'),[row('2021-07-20'),row('2024-06-10')]);
  const result=await f.store.readShard(actionShard('NVDA'));
  assert.equal(result[0].data.status,'cancelled');assert.equal(result[1].data.splitFactor,10);
  assert(result.every(r=>r.data.createdAt==='original'));
  await assert.rejects(f.store.mergeTicker('AMD',[row('2024-06-10')]),/shard mismatch/);
  await assert.rejects(f.store.mergeTicker('NVDA',[{id:'bad',data:{status:'cancelled'}}]),/Invalid corporate action/);
 }finally{await second.close();await f.store.close();}
});
