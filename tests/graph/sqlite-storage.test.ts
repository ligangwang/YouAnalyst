import {loadEntitySqlite} from '../../src/lib/entity-snapshots/sqlite';
import {syncPricePartitions} from '../../src/lib/entity-snapshots/price-sync';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Timestamp} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {sqliteSnapshotFiles} from '../../src/lib/entity-snapshots/sqlite-storage';
import {collections,syncCollection,type Source,type Row} from '../../src/lib/entity-snapshots/sync';
function bucketFixture(){
 const objects=new Map<string,{generation:string;bytes:Buffer;gzip?:boolean}>();let sequence=0,fail=false;
 const names:string[]=[];
 const bucket={file:(name:string,options?:{generation:string})=>{
  names.push(name);const selected=objects.get(name);
  return {name,download:async()=>[selected!.bytes],save:async(bytes:string,opts:{preconditionOpts:{ifGenerationMatch:string}})=>{if((objects.get(name)?.generation??'0')!==opts.preconditionOpts.ifGenerationMatch)throw Error('precondition');objects.set(name,{generation:String(++sequence),bytes:Buffer.from(bytes)});},getMetadata:async()=>{if(!selected)throw Object.assign(Error('missing'),{code:404});return [{generation:selected.generation,contentEncoding:selected.gzip?'gzip':undefined}];},
   createReadStream:(readOptions?:{decompress?:boolean})=>{assert.equal(options?.generation,selected?.generation);return Readable.from(selected!.gzip&&readOptions?.decompress!==false?gunzipSync(selected!.bytes):selected!.bytes);}};
 },upload:async(path:string,options:{destination:string;gzip?:boolean;preconditionOpts:{ifGenerationMatch:string}})=>{
  if(fail)throw Error('upload failed');
  const previous=objects.get(options.destination);
  if((previous?.generation??'0')!==options.preconditionOpts.ifGenerationMatch)throw Object.assign(Error('precondition'),{code:412});
  const bytes=await readFile(path);
  objects.set(options.destination,{generation:String(++sequence),bytes:options.gzip?gzipSync(bytes):bytes,gzip:options.gzip});
 }} as unknown as Bucket;
 return {bucket,objects,names,fail:(value=true)=>{fail=value;}};
}
for(const collection of collections)test(`${collection}: SQLite-only initial, incremental, delete, restore and restart`,async()=>{
 const fixture=bucketFixture();let files=sqliteSnapshotFiles(fixture.bucket),time=10;
 let changes:Row[]=[{id:'one',data:{name:'First',updatedAt:new Timestamp(9,123)}},{id:'two',data:{name:'Keep',updatedAt:new Timestamp(9,456)}}];
 const boundaries:(number|undefined)[]=[];
 const source:Source={boundary:async()=>new Timestamp(time,0),rows:async(name,since)=>{assert.equal(name,collection);boundaries.push(since?.seconds);return changes;}};
 try{
  assert.equal((await syncCollection(collection,source,files)).initial,true);
  assert.equal(fixture.objects.get(`entity-snapshots/${collection}.sqlite`)?.gzip,true);
  await files.close();files=sqliteSnapshotFiles(fixture.bucket);
  time=20;changes=[{id:'one',data:{name:'Updated',updatedAt:new Timestamp(19,0)}},{id:'three',data:{name:'Added',updatedAt:new Timestamp(19,0)}}];
  await syncCollection(collection,source,files);
  const second=(await files.load(collection)).snapshot!;
  assert.equal(second.watermark.seconds,20);assert.equal(second.rows.find(row=>row.id==='one')!.data.name,'Updated');
  assert.equal(second.rows.find(row=>row.id==='two')!.data.updatedAt.nanoseconds,456);
  time=30;changes=[{id:'one',data:{isDeleted:true,updatedAt:new Timestamp(29,0)}}];
  await syncCollection(collection,source,files);
  assert.equal((await files.load(collection)).snapshot!.rows.some(row=>row.id==='one'),false);
  time=40;changes=[{id:'one',data:{name:'Restored',isDeleted:false,updatedAt:new Timestamp(39,0)}}];
  await syncCollection(collection,source,files);
  assert.equal((await files.load(collection)).snapshot!.rows.find(row=>row.id==='one')!.data.name,'Restored');
  assert.deepEqual(boundaries,[undefined,10,20,30]);
  assert.ok(fixture.names.every(name=>name.endsWith('.sqlite')));
 }finally{await files.close();}
});
test('failed and stale publication preserve the last SQLite watermark',async()=>{
 const fixture=bucketFixture(),a=sqliteSnapshotFiles(fixture.bucket),b=sqliteSnapshotFiles(fixture.bucket);
 const make=(n:number)=>({version:1 as const,collection:'companies' as const,watermark:new Timestamp(n,0),rows:[]});
 try{
  await a.save('companies',make(10),'0');
  const first=await a.load('companies');await b.load('companies');
  await a.save('companies',make(20),first.generation);
  await assert.rejects(b.save('companies',make(30),first.generation),/precondition/);
  fixture.fail();const latest=await a.load('companies');
  await assert.rejects(a.save('companies',make(40),latest.generation),/upload failed/);
  assert.equal((await a.load('companies')).snapshot!.watermark.seconds,20);
 }finally{await a.close();await b.close();}
});
test('corrupt SQLite fails instead of falling back to JSON',async()=>{
 const fixture=bucketFixture();fixture.objects.set('entity-snapshots/companies.sqlite',{generation:'1',bytes:Buffer.from('corrupt')});
 const files=sqliteSnapshotFiles(fixture.bucket);
 try{await assert.rejects(files.load('companies'));assert.ok(fixture.names.every(name=>name.endsWith('.sqlite')));}
 finally{await files.close();}
});


test('price sync rewrites only changed ticker/year partitions, and failed publication replays from old checkpoint',async()=>{
 const f=bucketFixture();let time=10,changes:Row[]=[{id:'US_NVDA_2025-01-02',data:{close:1,updatedAt:new Timestamp(9,0)}},{id:'US_AMD_2026-01-02',data:{close:2,updatedAt:new Timestamp(9,0)}}];
 const boundaries:(number|undefined)[]=[];
 const source:Source={boundary:async()=>new Timestamp(time,0),rows:async(_c,since)=>{boundaries.push(since?.seconds);return changes;}};
 assert.equal((await syncPricePartitions(source,f.bucket)).partitions,2);
 const old=f.objects.get('price-snapshots/US/NVDA/2025.sqlite')!.generation;
 time=20;changes=[{id:'US_AMD_2026-01-02',data:{isDeleted:true,updatedAt:new Timestamp(19,0)}}];
 f.fail();await assert.rejects(syncPricePartitions(source,f.bucket),/upload failed/);f.fail(false);
 assert.equal((await syncPricePartitions(source,f.bucket)).partitions,1);
 assert.equal(f.objects.get('price-snapshots/US/NVDA/2025.sqlite')!.generation,old);
 const files=sqliteSnapshotFiles(f.bucket,()=> 'price-snapshots/US/AMD/2026.sqlite');
 try{assert.equal((await files.load('eod_prices')).snapshot!.rows.length,0);}finally{await files.close();}
 assert.deepEqual(boundaries,[undefined,10,10]);assert.equal(f.objects.has('entity-snapshots/eod_prices.sqlite'),false);
});


test('paged price catch-up merges interleaved partitions without the all-rows loader',async()=>{
 const f=bucketFixture();let time=10,fail=false;
 const row=(ticker:string,date:string,close:number):Row=>({id:`US_${ticker}_${date}`,data:{close,updatedAt:new Timestamp(time-1,123)}});
 let pages:Row[][]=[[row('AMD','2026-01-02',1),row('NVDA','2026-01-02',2)],[row('AMD','2026-01-03',3)]];
 const source:Source={boundary:async()=>new Timestamp(time,0),rows:async()=>{throw Error('unbounded loader');},pages:async function*(){for(const page of pages){yield page;if(fail)throw Error('interrupted read');}}};
 assert.deepEqual(await syncPricePartitions(source,f.bucket),{collection:'eod_prices',changed:3,partitions:2,records:3,deleted:0});
 const checkpoint=f.objects.get('price-snapshots/checkpoint.json');
 time=20;pages=[[row('AMD','2026-01-02',4)],[{id:'US_NVDA_2026-01-02',data:{isDeleted:true,updatedAt:new Timestamp(19,0)}}]];
 fail=true;await assert.rejects(syncPricePartitions(source,f.bucket),/interrupted read/);
 assert.equal(f.objects.get('price-snapshots/checkpoint.json'),checkpoint);
 fail=false;await syncPricePartitions(source,f.bucket);
 const files=sqliteSnapshotFiles(f.bucket,()=> 'price-snapshots/US/AMD/2026.sqlite');
 try{const rows=(await files.load('eod_prices')).snapshot!.rows;assert.deepEqual(rows.map(row=>row.data.close),[4,3]);assert.equal(rows[0].data.updatedAt.nanoseconds,123);}finally{await files.close();}
});

test('overlapping price publication cannot overwrite a newer partition or checkpoint',async()=>{
 const f=bucketFixture(),upload=f.bucket.upload.bind(f.bucket);let overlap=true;
 const source=(time:number):Source=>({boundary:async()=>new Timestamp(time,0),rows:async()=>[],pages:async function*(){yield [{id:'US_AMD_2026-01-02',data:{close:time,updatedAt:new Timestamp(time-1,0)}}];}});
 f.bucket.upload=(async(...args:Parameters<typeof upload>)=>{
  if(overlap){overlap=false;await syncPricePartitions(source(20),f.bucket);}
  return upload(...args);
 }) as unknown as typeof f.bucket.upload;
 await assert.rejects(syncPricePartitions(source(10),f.bucket),/precondition/);
 const checkpoint=f.objects.get('price-snapshots/checkpoint.json')!.bytes.toString();
 const files=sqliteSnapshotFiles(f.bucket,()=> 'price-snapshots/US/AMD/2026.sqlite');
 try{const snapshot=(await files.load('eod_prices')).snapshot!;assert.equal(snapshot.watermark.seconds,20);assert.equal(snapshot.rows[0].data.close,20);}finally{await files.close();}
 await assert.rejects(syncPricePartitions(source(10),f.bucket),/future/);
 assert.equal(f.objects.get('price-snapshots/checkpoint.json')!.bytes.toString(),checkpoint);
});


test('price file loads remain readable after their SQLite reader is closed',async()=>{
 const f=bucketFixture(),files=sqliteSnapshotFiles(f.bucket,()=> 'price-snapshots/US/AMD/2026.sqlite');
 const stamp=new Timestamp(12,345);
 await files.save('eod_prices',{version:1,collection:'eod_prices',watermark:stamp,rows:[{id:'US_AMD_2026-01-02',data:{close:100,updatedAt:stamp,nested:{source:'official'}}}]},'0');
 const logs:Record<string,unknown>[]=[];
 const rows=await loadEntitySqlite(f.bucket,'cold',entry=>logs.push(entry),'eod_prices','price-snapshots/US/AMD/2026.sqlite');
 assert.equal(rows!.get('US_AMD_2026-01-02')!.close,100);
 assert.deepEqual(rows!.get('US_AMD_2026-01-02')!.nested,{source:'official'});
 assert.equal(rows!.get('US_AMD_2026-01-02')!.updatedAt.nanoseconds,345);
 assert.equal(rows!.watermark!.nanoseconds,345);assert.equal(logs[0].rowsDecoded,1);
 await files.close();
});

test('compressed snapshots stream into readers with exact transfer accounting and reject truncated gzip',async()=>{
 const f=bucketFixture(),files=sqliteSnapshotFiles(f.bucket);
 try{
  await files.save('companies',{version:1,collection:'companies',watermark:new Timestamp(10,123),rows:[{id:'US:A',data:{name:'Alpha',onboarding:{status:'SUPPORTED'}}}]},'0');
  const object=f.objects.get('entity-snapshots/companies.sqlite')!;
  const logs:Record<string,unknown>[]=[];
  const rows=await loadEntitySqlite(f.bucket,'cold',entry=>logs.push(entry));
  assert.equal(rows?.get('US:A')?.name,'Alpha');assert.equal(rows?.watermark?.nanoseconds,123);
  assert.equal(logs[0].bytesDownloaded,object.bytes.length);assert.equal(logs[0].encoding,'gzip');
  object.bytes=object.bytes.subarray(0,object.bytes.length-8);
  await assert.rejects(loadEntitySqlite(f.bucket,'cold',()=>{}));
 }finally{await files.close();}
});
import {companyViewSnapshotFiles} from '../../src/lib/entity-snapshots/company-view-storage';
import {COMPANY_VIEW_OBJECT,companyViewData} from '../../src/lib/entity-snapshots/company-view';

test('derived view omits search payload without evaluating lazy getters',()=>{
 const data={name:'Alpha',updatedAt:new Timestamp(1,2),get searchPrefixes(){throw Error('expanded prefixes');},get searchTerms(){throw Error('expanded terms');}};
 assert.deepEqual(companyViewData(data),{name:'Alpha',updatedAt:new Timestamp(1,2)});
});

test('view publication preserves complete snapshot, watermark, updates and stale-writer protection',async()=>{
 const f=bucketFixture(),a=companyViewSnapshotFiles(f.bucket),b=companyViewSnapshotFiles(f.bucket);
 const make=(seconds:number,name:string)=>({version:1 as const,collection:'companies' as const,watermark:new Timestamp(seconds,123),rows:[{id:'A',data:{name,themeIds:['ai'],onboarding:{status:'SUPPORTED'},searchPrefixes:['alpha'],searchTerms:['alpha'],updatedAt:new Timestamp(seconds,0)}}]});
 try{
  await a.save('companies',make(10,'Old'),'0');
  const old=await b.load('companies');
  const full=await a.load('companies');
  assert.deepEqual(full.snapshot!.rows[0].data.searchPrefixes,['alpha']);
  const view=await loadEntitySqlite(f.bucket,'cold',()=>{},'companies',COMPANY_VIEW_OBJECT);
  assert.equal(view!.get('A')!.name,'Old');assert.equal(view!.get('A')!.searchPrefixes,undefined);
  assert.equal(view!.watermark!.nanoseconds,123);
  assert.deepEqual([...view!.candidateIds!('onboarding.status','==','SUPPORTED')!],['A']);
  await a.save('companies',make(20,'New'),full.generation);
  const generation=f.objects.get(COMPANY_VIEW_OBJECT)!.generation;
  await assert.rejects(b.save('companies',make(30,'Stale'),old.generation),/precondition/);
  assert.equal(f.objects.get(COMPANY_VIEW_OBJECT)!.generation,generation);
  const latest=await loadEntitySqlite(f.bucket,'cold',()=>{},'companies',COMPANY_VIEW_OBJECT);
  assert.equal(latest!.get('A')!.name,'New');assert.equal(latest!.watermark!.seconds,20);
 }finally{await a.close();await b.close();}
});
