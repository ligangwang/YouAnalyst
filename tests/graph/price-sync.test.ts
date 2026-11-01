import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {gunzipSync} from 'node:zlib';
import {Timestamp} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {syncPricePartitions,priceSyncOptions} from '../../src/lib/entity-snapshots/price-sync';
import {sqliteSnapshotFiles} from '../../src/lib/entity-snapshots/sqlite-storage';
import {encode,decode} from '../../src/lib/central-cache/codec';
import type {Source,Row,PriceCursor} from '../../src/lib/entity-snapshots/sync';
const stamp=(n:number,nanos=0)=>new Timestamp(n,nanos);
const row=(ticker:string,date='2026-01-02',time=9,nanos=123):Row=>({id:`US_${ticker}_${date}`,data:{close:time,updatedAt:stamp(time,nanos)}});
const progressName='price-snapshots/progress.json',checkpointName='price-snapshots/checkpoint.json';
function fixture(){
 const objects=new Map<string,{generation:string;bytes:Buffer;gzip?:boolean}>();let seq=0;
 const f={objects,failUpload:false,beforeSave:undefined as undefined|((name:string)=>void),beforeUpload:undefined as undefined|((name:string)=>Promise<void>),beforeDownload:undefined as undefined|((name:string)=>void)};
 const missing=()=>Object.assign(Error('missing'),{code:404});
 const bucket={file:(name:string,options?:{generation:string})=>({name,
  getMetadata:async()=>{const obj=objects.get(name);if(!obj)throw missing();return [{generation:obj.generation,contentEncoding:obj.gzip?'gzip':undefined}];},
  download:async()=>{f.beforeDownload?.(name);const obj=objects.get(name);if(!obj)throw missing();if(options?.generation)assert.equal(options.generation,obj.generation);return [obj.bytes];},
  save:async(bytes:string|Buffer,opts:{preconditionOpts:{ifGenerationMatch:string|number}})=>{
   f.beforeSave?.(name);
   if((objects.get(name)?.generation??'0')!==String(opts.preconditionOpts.ifGenerationMatch))throw Object.assign(Error('precondition'),{code:412});
   objects.set(name,{generation:String(++seq),bytes:Buffer.from(bytes)});
  },
  delete:async()=>{objects.delete(name);},
  createReadStream:()=>{const obj=objects.get(name)!;assert.equal(options?.generation,obj.generation);return Readable.from(obj.gzip?gunzipSync(obj.bytes):obj.bytes);},
 }),upload:async(path:string,opts:{destination:string;gzip?:boolean;preconditionOpts:{ifGenerationMatch:string}})=>{
  await f.beforeUpload?.(opts.destination);if(f.failUpload)throw Error('upload failed');
  if((objects.get(opts.destination)?.generation??'0')!==String(opts.preconditionOpts.ifGenerationMatch))throw Object.assign(Error('precondition'),{code:412});
  // File bytes suffice for these tests; the production SDK applies gzip.
  objects.set(opts.destination,{generation:String(++seq),bytes:await readFile(path)});
 }} as unknown as Bucket;
 return {...f,bucket,controls:f};
}
function sourceFixture(initial:Row[],pageSize=250){
 const state={rows:initial,time:10,reads:[] as string[],calls:0,boundaries:0,failAt:0,cursors:[] as (PriceCursor|undefined)[]};
 const source:Source={boundary:async()=>{state.boundaries++;return stamp(state.time);},rows:async()=>{throw Error('unbounded loader');},
  pricePage:async(since,through,cursor,limit)=>{
   state.calls++;if(state.calls===state.failAt)throw Error('interrupted read');
   state.cursors.push(cursor);
   const key=(r:Row)=>since?`${(r.data.updatedAt as Timestamp).valueOf()}/${r.id}`:r.id;
   const after=cursor?(since?`${cursor.updatedAt!.valueOf()}/${cursor.id}`:cursor.id):undefined;
   const selected=state.rows.filter(r=>(!since||(r.data.updatedAt.valueOf()>=since.valueOf()&&r.data.updatedAt.valueOf()<=through.valueOf()))&&(!after||key(r)>after))
    .sort((a,b)=>key(a)<key(b)?-1:1).slice(0,Math.min(limit,pageSize));
   state.reads.push(...selected.map(r=>r.id));const last=selected.at(-1);
   return {rows:selected,reads:Math.max(1,selected.length),done:selected.length<Math.min(limit,pageSize),cursor:last?{id:last.id,...(since?{updatedAt:last.data.updatedAt}: {})}:cursor};
  }};
 return {source,state};
}
async function prices(bucket:Bucket,ticker:string){
 const files=sqliteSnapshotFiles(bucket,()=>`price-snapshots/US/${ticker}/2026.sqlite`);
 try{const snapshot=(await files.load('eod_prices')).snapshot;return snapshot?{...snapshot,rows:snapshot.rows.map(r=>({id:r.id,data:{...r.data}}))}:undefined;}finally{await files.close();}
}

test('strict per-run budget, restart cursors, no partial publication and interleaved partitions',async()=>{
 const f=fixture(),s=sourceFixture([row('AMD'),row('NVDA'),row('AMD','2026-01-03')]);
 assert.equal((await syncPricePartitions(s.source,f.bucket,{maxReads:2})).status,'partial');
 assert.equal(s.state.reads.length,2);assert.equal(f.objects.has(checkpointName),false);assert.equal(await prices(f.bucket,'AMD'),undefined);
 s.state.time=20;
 const result=await syncPricePartitions(s.source,f.bucket,{maxReads:2});
 assert.equal(result.status,'complete');assert.equal(result.reads,1);assert.equal(result.partitions,2);
 assert.equal(new Set(s.state.reads).size,3);assert.equal(s.state.boundaries,1);
 assert.deepEqual((await prices(f.bucket,'AMD'))!.rows.map(r=>r.data.close),[9,9]);
 assert.equal((await prices(f.bucket,'AMD'))!.watermark.seconds,10);
 assert(![...f.objects.keys()].some(k=>k.includes('/staging/')));
});

test('an interrupted fetch resumes completed pages without rereading them',async()=>{
 const f=fixture(),s=sourceFixture([row('A'),row('B'),row('C')],1);s.state.failAt=2;
 await assert.rejects(syncPricePartitions(s.source,f.bucket),/interrupted read/);
 assert.deepEqual(s.state.reads,[row('A').id]);
 s.state.failAt=0;assert.equal((await syncPricePartitions(s.source,f.bucket)).status,'complete');
 assert.equal(new Set(s.state.reads).size,s.state.reads.length);assert.equal(s.state.reads.length,3);
});

test('uploaded page survives a failed cursor save, including failure of lease release',async()=>{
 const f=fixture(),s=sourceFixture([row('A'),row('B')],1);let failed=false;
 f.controls.beforeSave=name=>{if(name===progressName&&[...f.objects.keys()].some(k=>k.includes('/staging/'))) {failed=true;throw Error('checkpoint unavailable');}};
 await assert.rejects(syncPricePartitions(s.source,f.bucket,{now:()=>0}),/checkpoint unavailable/);assert(failed);
 assert.deepEqual(s.state.reads,[row('A').id]);f.controls.beforeSave=undefined;
 assert.equal((await syncPricePartitions(s.source,f.bucket,{now:()=>36*60_000})).status,'complete');
 assert.deepEqual(s.state.reads,[row('A').id,row('B').id]);
});

test('publication failure resumes from storage, preserves deletes and untouched partitions',async()=>{
 const f=fixture(),s=sourceFixture([row('AMD'),row('NVDA')]);await syncPricePartitions(s.source,f.bucket);
 const old=f.objects.get('price-snapshots/US/NVDA/2026.sqlite')!.generation;
 s.state.time=20;s.state.rows=[{...row('AMD','2026-01-02',19),data:{updatedAt:stamp(19,456),isDeleted:true}}];
 f.controls.failUpload=true;await assert.rejects(syncPricePartitions(s.source,f.bucket),/upload failed/);
 const reads=s.state.reads.length;f.controls.failUpload=false;
 await syncPricePartitions(s.source,f.bucket);assert.equal(s.state.reads.length,reads);
 assert.equal((await prices(f.bucket,'AMD'))!.rows.length,0);assert.equal(f.objects.get('price-snapshots/US/NVDA/2026.sqlite')!.generation,old);
});

test('publication itself is bounded and resumes after the last completed partition',async()=>{
 const f=fixture(),s=sourceFixture([row('A'),row('B'),row('C')]);
 assert.equal((await syncPricePartitions(s.source,f.bucket,{maxPartitions:1})).status,'partial');
 const first=f.objects.get('price-snapshots/US/A/2026.sqlite')!.generation;
 assert.equal(f.objects.has(checkpointName),false);const calls=s.state.calls;
 await syncPricePartitions(s.source,f.bucket,{maxPartitions:1});
 assert.equal((await syncPricePartitions(s.source,f.bucket,{maxPartitions:1})).status,'complete');
 assert.equal(s.state.calls,calls);assert.equal(f.objects.get('price-snapshots/US/A/2026.sqlite')!.generation,first);
});

test('incremental equal timestamps resume with nanoseconds and ID; later changes wait for next window',async()=>{
 const f=fixture(),s=sourceFixture([]);await syncPricePartitions(s.source,f.bucket);
 s.state.time=20;s.state.rows=[row('B','2026-01-02',19,111),row('A','2026-01-02',19,111),row('C','2026-01-02',21)];
 await syncPricePartitions(s.source,f.bucket,{maxReads:1});
 s.state.time=30;await syncPricePartitions(s.source,f.bucket,{maxReads:1});await syncPricePartitions(s.source,f.bucket);
 assert.equal(s.state.cursors.at(-1)!.updatedAt!.nanoseconds,111);
 assert.deepEqual(s.state.reads,[row('A').id,row('B').id]);
 assert.equal((await prices(f.bucket,'A'))!.watermark.seconds,20);
 await syncPricePartitions(s.source,f.bucket);assert.equal(s.state.reads.at(-1),row('C').id);
});

test('overlapping workers do no price reads or publication while lease is active',async()=>{
 const f=fixture(),s=sourceFixture([row('A')]);let overlap=true;
 f.controls.beforeUpload=async()=>{if(overlap){overlap=false;const other=sourceFixture([row('B')]);
  assert.equal((await syncPricePartitions(other.source,f.bucket)).status,'busy');assert.equal(other.state.calls,0);
 }};
 assert.equal((await syncPricePartitions(s.source,f.bucket)).status,'complete');assert.equal(await prices(f.bucket,'B'),undefined);
});

test('deadline yields saved progress; bad configuration fails before reads',async()=>{
 const f=fixture(),s=sourceFixture([row('A')]);let ticks=0;
 const r=await syncPricePartitions(s.source,f.bucket,{now:()=>ticks++,maxDurationMs:1});
 assert.equal(r.status,'partial');assert.equal(s.state.calls,0);
 await syncPricePartitions(s.source,f.bucket);assert.equal(s.state.reads.length,1);
 assert.throws(()=>priceSyncOptions({PRICE_SYNC_MAX_READS:'0'}),/Invalid/);
 await assert.rejects(syncPricePartitions(s.source,f.bucket,{maxReads:NaN}),/Invalid/);
});

test('legacy checkpoint is retained until complete and corrupt saved progress fails closed',async()=>{
 const f=fixture(),s=sourceFixture([row('A')]);
 f.objects.set(checkpointName,{generation:'legacy',bytes:Buffer.from(JSON.stringify({watermark:encode(stamp(1))}))});
 await syncPricePartitions(s.source,f.bucket,{maxReads:1});
 assert.equal(f.objects.get(checkpointName)!.generation,'legacy');
 await syncPricePartitions(s.source,f.bucket);
 const p=decode(JSON.parse(f.objects.get(progressName)!.bytes.toString()));assert.equal(p.pending,undefined);
 f.objects.set(progressName,{generation:'bad',bytes:Buffer.from('bad json')});
 const calls=s.state.calls;await assert.rejects(syncPricePartitions(s.source,f.bucket));assert.equal(s.state.calls,calls);
});


test('crash after completed watermark publication recovers without rescanning or republishing',async()=>{
 const f=fixture(),s=sourceFixture([row('A')]);
 f.controls.beforeSave=name=>{if(name===progressName&&f.objects.has(checkpointName))throw Error('lost progress save');};
 await assert.rejects(syncPricePartitions(s.source,f.bucket,{now:()=>0}),/lost progress save/);
 const calls=s.state.calls,generation=f.objects.get('price-snapshots/US/A/2026.sqlite')!.generation;
 f.controls.beforeSave=undefined;
 assert.equal((await syncPricePartitions(s.source,f.bucket,{now:()=>36*60_000})).status,'complete');
 assert.equal(s.state.calls,calls);assert.equal(f.objects.get('price-snapshots/US/A/2026.sqlite')!.generation,generation);
 assert(![...f.objects.keys()].some(k=>k.includes('/staging/')));
});

test('newer partition and malformed checkpoint fail closed without losing its contents',async()=>{
 const f=fixture(),s=sourceFixture([row('A')]),files=sqliteSnapshotFiles(f.bucket,()=> 'price-snapshots/US/A/2026.sqlite');
 try{await files.save('eod_prices',{version:1,collection:'eod_prices',watermark:stamp(20),rows:[row('A','2026-01-02',19)]},'0');}finally{await files.close();}
 await assert.rejects(syncPricePartitions(s.source,f.bucket),/Newer price partition/);
 assert.equal((await prices(f.bucket,'A'))!.rows[0].data.close,19);assert.equal(f.objects.has(checkpointName),false);
 const other=fixture();other.objects.set(checkpointName,{generation:'bad',bytes:Buffer.from(JSON.stringify({watermark:encode(null)}))});
 const calls=s.state.calls;await assert.rejects(syncPricePartitions(s.source,other.bucket),/Invalid price sync checkpoint/);assert.equal(s.state.calls,calls);
});


test('publication resumes from the durable index without downloading saved pages again',async()=>{
 const f=fixture(),s=sourceFixture([row('A'),row('B'),row('C')]);
 assert.equal((await syncPricePartitions(s.source,f.bucket,{maxPartitions:1})).status,'partial');
 assert([...f.objects.keys()].some(k=>k.endsWith('/changes.sqlite')));
 f.controls.beforeDownload=name=>{if(name.endsWith('.json.gz'))throw Error('journal replay');};
 const reads=s.state.reads.length;
 assert.equal((await syncPricePartitions(s.source,f.bucket,{publishConcurrency:2})).status,'complete');
 assert.equal(s.state.reads.length,reads);
 assert(![...f.objects.keys()].some(k=>k.includes('/staging/')));
});

test('parallel publication waits for all in-flight uploads before releasing its lease after failure',async()=>{
 const f=fixture(),s=sourceFixture([row('A'),row('B')]);let settled=false;
 f.controls.beforeUpload=async name=>{
  if(name.endsWith('/A/2026.sqlite'))throw Error('failed A');
  if(name.endsWith('/B/2026.sqlite')){await new Promise(resolve=>setTimeout(resolve,20));settled=true;}
 };
 await assert.rejects(syncPricePartitions(s.source,f.bucket,{publishConcurrency:2}),/failed A/);
 assert(settled);const p=decode(JSON.parse(f.objects.get(progressName)!.bytes.toString()));
 assert.equal(p.leaseUntil,0);assert.equal(p.pending.lastPublished,undefined);
 const reads=s.state.reads.length;f.controls.beforeUpload=undefined;
 assert.equal((await syncPricePartitions(s.source,f.bucket,{publishConcurrency:2})).status,'complete');assert.equal(s.state.reads.length,reads);
});

test('large scan pages still obey a non-multiple read budget across restarts',async()=>{
 const f=fixture(),s=sourceFixture(Array.from({length:1600},(_,i)=>row('P'+String(i).padStart(4,'0'))),1000);
 const a=await syncPricePartitions(s.source,f.bucket,{pageSize:1000,maxReads:1251});assert.equal(a.reads,1251);assert.equal(a.status,'partial');
 const b=await syncPricePartitions(s.source,f.bucket,{pageSize:1000,maxReads:100,maxPartitions:1});assert.equal(b.reads,100);assert.equal(new Set(s.state.reads).size,1351);
 await assert.rejects(syncPricePartitions(s.source,f.bucket,{pageSize:1001}),/limit/);
});
