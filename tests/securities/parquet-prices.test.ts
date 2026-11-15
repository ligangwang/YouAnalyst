import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Timestamp,FieldPath} from 'firebase-admin/firestore';
import {writePriceParquet,readPriceParquet} from '../../src/lib/price-store/parquet';
import {compileQuery} from '../../src/lib/price-store/query';
import {PriceStore,readHead,saveHead,HEAD} from '../../src/lib/price-store/storage';
import type {Bucket} from '@google-cloud/storage';
import {Firestore} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {writeCachedPrice,createCachedPriceBatch} from '../../src/lib/intelligence/price-cache';
import {exportPrices} from '../../src/lib/price-store/migration';

function fixture(){
 let sequence=0;const objects=new Map<string,{generation:string;bytes:Buffer}>();
 const failure=(code:number)=>Object.assign(Error(String(code)),{code});
 const bucket={file:(name:string,pinned?:{generation:string})=>({
  getMetadata:async()=>{const entry=objects.get(name);if(!entry)throw failure(404);return [{generation:entry.generation}];},
  download:async(options?:{destination:string})=>{const entry=objects.get(name);if(!entry||pinned&&pinned.generation!==entry.generation)throw failure(404);if(options)await writeFile(options.destination,entry.bytes);return [entry.bytes];},
  save:async(bytes:string,options:{preconditionOpts:{ifGenerationMatch:string}})=>{if((objects.get(name)?.generation??'0')!==String(options.preconditionOpts.ifGenerationMatch))throw failure(412);objects.set(name,{generation:String(++sequence),bytes:Buffer.from(bytes)});},
 }),upload:async(path:string,options:{destination:string})=>{objects.set(options.destination,{generation:String(++sequence),bytes:await readFile(path)});}} as unknown as Bucket;
 return {objects,bucket,store:new PriceStore(bucket)};
}
const row=(ticker:string,date:string,close:number)=>({id:`US_${ticker}_${date}`,data:{ticker,market:'US',tradingDate:date,close,rawClose:close,isFinal:true,updatedAt:new Timestamp(10,123)}});
async function seed(f:ReturnType<typeof fixture>){
 const file=await f.store.upload([row('A','2026-01-01',10),row('A','2026-01-02',11),row('B','2025-12-31',20)]);
 await saveHead(f.bucket,await readHead(f.bucket),{version:1,ready:true,files:[file]});
}

test('Parquet preserves original prices, metadata, nulls and nanosecond timestamps',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'price-test-'));
 try{
  const rows=[{id:'CN_A_XSHE:002086_2026-11-13',data:{ticker:'XSHE:002086',market:'CN_A',close:4.82,rawClose:4.82,volume:612408843,tradingDate:'2026-11-13',previousClose:null,updatedAt:new Timestamp(1794574836,933000001),isFinal:true}}];
  const path=join(directory,'prices.parquet');await writePriceParquet(path,rows);
  assert.deepEqual(await readPriceParquet(path),rows);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('query pagination preserves descending ties and rejects unknown operators',()=>{
 const plan=compileQuery([{method:'orderBy',args:['tradingDate','desc']},{method:'startAfter',args:[{id:'US_B_2026-11-13',get:()=> '2026-11-13'}]},{method:'limit',args:[20]}]);
 assert(plan.where.includes('"id" < \'US_B_2026-11-13\''));assert.equal(plan.limit,20);
 assert.equal(compileQuery([{method:'orderBy',args:[FieldPath.documentId()]}]).order,'"id" asc');
 assert.throws(()=>compileQuery([{method:'where',args:['ticker','bogus','A']}]),/Unsupported/);
 assert.throws(()=>compileQuery([{method:'limit',args:[10001]}]),/bounded/);
});

test('immutable publication preserves concurrent corrections, create guards, deletes and pagination',async()=>{
 const f=fixture();try{
  await seed(f);
  await Promise.all([f.store.mutate([{id:'US_A_2026-01-01',data:{close:12}}]),f.store.mutate([{id:'US_A_2026-01-02',data:{close:13}}])]);
  const rows=await f.store.query([{method:'where',args:['ticker','==','A']},{method:'orderBy',args:['tradingDate','desc']}]);
  assert.deepEqual(rows.map(r=>r.data.close),[13,12]);
  await assert.rejects(f.store.mutate([{id:rows[0].id,data:{close:99},mode:'create'}]),{code:6});
  await assert.rejects(f.store.mutate([{id:rows[0].id,data:{close:99},updateTime:new Timestamp(1,0)}]),{code:9});
  assert.deepEqual(await f.store.mutate([{id:rows[0].id,data:{close:99},mode:'missing'}]),{created:0,existing:1});
  await f.store.mutate([{id:rows[0].id,data:{},mode:'delete'}]);
  const deleted=(await f.store.query([{method:'where',args:['id','==',rows[0].id]}]))[0];assert.equal(deleted.data.isDeleted,true);
  await f.store.mutate([{id:rows[0].id,data:{isDeleted:false}}]);
  const restored=(await f.store.query([{method:'where',args:['id','==',rows[0].id]}]))[0];assert.equal(restored.data.isDeleted,false);assert.equal(restored.data.deletedAt,undefined);
  assert.equal((await f.store.query([{method:'orderBy',args:['id']},{method:'startAfter',args:['US_A_2026-01-01']},{method:'limit',args:[1]}]))[0].id,'US_A_2026-01-02');
 }finally{await f.store.close();}
});

test('production adapter serves point, batch, cursor and price writes without Firestore RPCs',async()=>{
 const f=fixture(),old=process.env.PRICE_STORAGE;try{
  await seed(f);process.env.PRICE_STORAGE='parquet';globalThis.__youAnalystParquetStore=Promise.resolve(f.store);
  const db=observeFirestore(new Firestore({projectId:'demo-parquet'}),()=>{throw Error('Unexpected Firestore operation');});
  const first=await db.collection('eod_prices').orderBy('tradingDate','desc').limit(1).get();assert.equal(first.docs[0].get('close'),11);
  const next=await db.collection('eod_prices').orderBy('tradingDate','desc').startAfter(first.docs[0]).limit(1).get();assert.equal(next.docs[0].get('close'),10);
  const refs=['US_A_2026-01-01','US_MISSING_2026-01-01'].map(id=>db.collection('eod_prices').doc(id));
  const docs=await db.getAll(...refs);assert.deepEqual(docs.map(d=>d.exists),[true,false]);
  await writeCachedPrice(db,refs[0],{close:15});assert.equal((await refs[0].get()).get('close'),15);
  assert.deepEqual(await createCachedPriceBatch(db,[{ref:refs[0],patch:row('A','2026-01-01',99).data}]),{created:0,existing:1});
  const before=f.objects.get(HEAD)!.generation;
  await refs[0].set({close:16},{merge:true});assert.notEqual(f.objects.get(HEAD)!.generation,before);assert.equal((await refs[0].get()).get('rawClose'),10);
 }finally{if(old===undefined)delete process.env.PRICE_STORAGE;else process.env.PRICE_STORAGE=old;globalThis.__youAnalystParquetStore=undefined;await f.store.close();}
});

test('compaction preserves every field and retains the newest correction',async()=>{
 const f=fixture();try{
  await seed(f);await f.store.mutate([{id:'US_A_2026-01-01',data:{close:25}}]);
  const head=await readHead(f.bucket),group=head.manifest.files[0].groups.find(g=>g.includes('/2026/'))!;
  const compacted=await f.store.compactGroup(head,group);
  const rows=await f.store.local([compacted.name],paths=>readPriceParquet(paths[0]));
  assert.equal(rows.find(r=>r.id==='US_A_2026-01-01')!.data.close,25);
  assert.equal(rows.find(r=>r.id==='US_A_2026-01-01')!.data.rawClose,10);
  assert.equal(rows.length,2);
 }finally{await f.store.close();}
});

test('full export resumes its cursor and verifies every field before becoming ready',async()=>{
 const f=fixture(),rows=[row('A','2026-01-01',10),row('A','2026-01-02',11),row('B','2025-12-31',20)];
 function query(cursor='',limit=5000):unknown{return {orderBy:()=>query(cursor,limit),limit:(n:number)=>query(cursor,n),startAfter:(id:string)=>query(id,limit),get:async()=>{
  const docs=rows.filter(r=>r.id>cursor).slice(0,limit).map(r=>({id:r.id,data:()=>r.data}));return {docs,size:docs.length,readTime:new Timestamp(20,0)};
 }};}
 const db={collection:()=>query()} as unknown as Firestore;
 try{
  assert.equal((await exportPrices(db,f.store,{maxReads:2,maxDurationMs:10000})).status,'partial');
  const partial=await readHead(f.bucket);assert.equal(partial.manifest.ready,false);assert.equal(partial.manifest.cursor,rows[1].id);
  assert.equal((await exportPrices(db,f.store,{maxReads:2,maxDurationMs:10000})).status,'complete');
  const head=await readHead(f.bucket);assert.equal(head.manifest.files.reduce((n,file)=>n+file.rows,0),3);
  assert.deepEqual(await f.store.query([{method:'orderBy',args:['id']}]),rows);
 }finally{await f.store.close();}
});
