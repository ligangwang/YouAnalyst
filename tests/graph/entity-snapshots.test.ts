import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable,Writable} from 'node:stream';
import {Timestamp,FieldValue,type Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {snapshotFiles} from '../../src/lib/entity-snapshots/storage';
import {snapshotSource} from '../../src/lib/entity-snapshots/firestore-source';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {syncCollection,collections,type Files,type Source,type Snapshot,type Row} from '../../src/lib/entity-snapshots/sync';
import {entityPatch,lifecycleFields} from '../../src/lib/entity-snapshots/lifecycle';
const stamp=(n:number)=>new Timestamp(n,0);
for(const incremental of [false,true])test(`snapshot pagination uses bounded scalar cursors (${incremental?'incremental':'initial'})`,async()=>{
 const records=Array.from({length:751},(_,i)=>({id:String(i).padStart(4,'0'),data:{updatedAt:stamp(Math.floor(i/300)+1)}}));
 const seen:string[]=[];let pages=0;
 const query=(cursor?:unknown[],depth=0):unknown=>({
   where:()=>query(cursor,depth),orderBy:()=>query(cursor,depth),limit:()=>query(cursor,depth),
   startAfter:(...values:unknown[])=>{assert.equal(depth,0,'each page starts from the base query');assert.equal(values.length,incremental?2:1);assert.equal(typeof values.at(-1),'string');if(incremental)assert.ok(values[0] instanceof Timestamp);return query(values,depth+1);},
   get:async()=>{pages++;const after=cursor?.at(-1) as string|undefined;
     const slice=records.filter(row=>after===undefined||row.id>after).slice(0,250);seen.push(...slice.map(row=>row.id));
     return {size:slice.length,docs:slice.map(row=>({id:row.id,data:()=>row.data,get:(key:string)=>row.data[key as 'updatedAt']}))};
   },
 });
 const db={collection:()=>query()} as unknown as Firestore;
 const rows=await snapshotSource(db).rows('companies',incremental?stamp(1):undefined,stamp(5));
 assert.equal(pages,4);assert.deepEqual(rows.map(row=>row.id),records.map(row=>row.id));assert.equal(new Set(seen).size,751);
});
for(const collection of collections)test(`${collection}: initial load, incremental edit, soft delete, restore`,async()=>{
 let saved:Snapshot|undefined,delta:Row[]=[{id:'A',data:{updatedAt:stamp(1)}}];let now=2;
 const files:Files={load:async()=>({snapshot:saved,generation:'1'}),save:async(_c,s)=>{saved=s;}};
 const source:Source={boundary:async()=>stamp(now++),rows:async(_c,since)=>{assert.equal(since?.seconds,saved?.watermark.seconds);return delta;}};
 await syncCollection(collection,source,files);
 delta=[{id:'B',data:{updatedAt:stamp(2)}},{id:'A',data:{updatedAt:stamp(2),name:'changed'}}];
 await syncCollection(collection,source,files);assert.equal(saved!.rows[0].data.name,'changed');
 delta=[{id:'A',data:{isDeleted:true,updatedAt:stamp(3)}}];
 await syncCollection(collection,source,files);assert.deepEqual(saved!.rows.map(r=>r.id),['B']);
 delta=[{id:'A',data:{updatedAt:stamp(4),isDeleted:false,name:'restored'}}];
 await syncCollection(collection,source,files);assert.equal(saved!.rows[0].data.name,'restored');
});
test('failed publication keeps the prior watermark; missing timestamps fail closed',async()=>{
 const prior:Snapshot={version:1,collection:'companies',watermark:stamp(1),rows:[]};
 const files:Files={load:async()=>({snapshot:prior,generation:'1'}),save:async()=>{throw Error('generation conflict');}};
 const source:Source={boundary:async()=>stamp(2),rows:async()=>[]};
 await assert.rejects(syncCollection('companies',source,files),/generation conflict/);assert.equal(prior.watermark.seconds,1);
 source.rows=async()=>[{id:'B',data:{}}];
 await assert.rejects(syncCollection('companies',source,files),/migration required/);
});
test('delete is idempotent; first edit preserves deletion time; further edits keep it; restoration clears it',()=>{
 const active={name:'A',updatedAt:stamp(1)};
 const deleted=entityPatch(active,{},'delete')!;
 assert.equal(deleted.isDeleted,true);assert.equal(active.updatedAt.seconds,1);
 const stored={...active,isDeleted:true,updatedAt:stamp(2)};
 assert.equal(entityPatch(stored,{},'delete'),null);
 const first=entityPatch(stored,{name:'B'})!;
 assert.equal(first.deletedAt,stored.updatedAt);assert.equal(first.isDeleted,true);
 const later=entityPatch({...stored,...first,updatedAt:stamp(3)},{name:'C'})!;
 assert.equal(later.deletedAt,stored.updatedAt);
 assert.equal(entityPatch({...stored,deletedAt:stamp(2)},{},'restore')!.isDeleted,false);
 assert.equal(Object.hasOwn(lifecycleFields({...stored,deletedAt:stamp(2)},false,true),'deletedAt'),false);
 assert.throws(()=>entityPatch(stored,{isDeleted:false}),/actions/);
});

// SDK-shaped transaction fixture: reject physical deletion and reads after writes.
test('shared writer preserves lifecycle on direct edits and reuses transaction reads',async()=>{
 const stored=new Map<string,Record<string,unknown>>();let tick=10,reads=0;
 const reference=(path:string)=>({path,get:async()=>snapshot(path),set:async()=>{},update:async()=>{},delete:async()=>{},create:async()=>{}});
 const snapshot=(path:string)=>({ref:reference(path),exists:stored.has(path),data:()=>stored.get(path)});
 const raw={doc:reference,async runTransaction(work:(tx:unknown)=>Promise<unknown>){
   let writing=false;const pending:{path:string;data:Record<string,unknown>;merge:boolean}[]=[];
   const tx={get:async(ref:{path:string})=>{assert.equal(writing,false);reads++;return snapshot(ref.path);},
     set:(ref:{path:string},data:Record<string,unknown>,options?:{merge?:boolean})=>{writing=true;pending.push({path:ref.path,data,merge:!!options?.merge});},
     update:(ref:{path:string},...args:unknown[])=>{writing=true;const data=typeof args[0]==='string'?Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[String(args[i*2]),args[i*2+1]])):args[0] as Record<string,unknown>;pending.push({path:ref.path,data,merge:true});},
     delete:()=>{throw Error('Physical delete forbidden');}};
   const result=await work(tx);
   for(const write of pending){const next=write.merge?{...stored.get(write.path)}:{};
     for(const [key,value] of Object.entries(write.data)){
       if(value instanceof FieldValue && value.isEqual(FieldValue.delete()))delete next[key];
       else next[key]=value instanceof FieldValue&&value.isEqual(FieldValue.serverTimestamp())?stamp(tick):value;
     }
     stored.set(write.path,next);
   }tick++;return result;
 }};
 const db=observeFirestore(raw as unknown as Firestore,()=>{});
 for(const collection of collections){
   const path=`${collection}/A`,ref=db.doc(path);stored.set(path,{name:'A',updatedAt:stamp(1)});
   await ref.delete();const deletedTime=stored.get(path)!.updatedAt;
   assert.ok(deletedTime instanceof Timestamp && deletedTime.seconds>1,'every entity delete advances updatedAt');
   assert.equal(stored.get(path)!.isDeleted,true);assert.equal(Object.hasOwn(stored.get(path)!,'deletedAt'),false);
   await ref.set({name:'B'});assert.equal(stored.get(path)!.deletedAt,deletedTime);
   assert.ok((stored.get(path)!.updatedAt as Timestamp).seconds>(deletedTime as Timestamp).seconds,'edits advance updatedAt while preserving deletion time');
   assert.equal(stored.get(path)!.isDeleted,true);
   await ref.update('name','C');assert.equal(stored.get(path)!.deletedAt,deletedTime);
   reads=0;await db.runTransaction(async tx=>{await tx.get(ref);tx.update(ref,{isDeleted:false});});
   assert.equal(reads,1);assert.equal(stored.get(path)!.isDeleted,false);assert.equal(Object.hasOwn(stored.get(path)!,'deletedAt'),false);
 }
});

test('snapshot storage preserves timestamps and refuses a stale publisher',async()=>{
 let generation=0,content='';
 const bucket={file:(name:string,options?:{generation:string})=>({name,
   getMetadata:async()=>{if(!generation)throw Object.assign(Error('missing'),{code:404});return [{generation:String(generation)}];},
   createReadStream:()=>{assert.equal(options?.generation,String(generation));return Readable.from([content]);},
   createWriteStream:(config:{preconditionOpts:{ifGenerationMatch:string}})=>{
     let text='';return new Writable({
       write(chunk,_encoding,done){text+=chunk.toString();done();},
       final(done){if(config.preconditionOpts.ifGenerationMatch!==String(generation)){done(Object.assign(Error('conflict'),{code:412}));return;}
         content=text;generation++;done();},
     });
   },
 })} as unknown as Bucket;
 const files=snapshotFiles(bucket);
 const timings:Record<string,unknown>[]=[];const timingOptions={reason:'cold' as const,log:(entry:Record<string,unknown>)=>{timings.push(entry);}};
 assert.equal((await files.load('companies',undefined,timingOptions)).generation,'0');
 assert.equal(timings.at(-1)?.status,'missing');assert.equal(timings.at(-1)?.bytesDownloaded,0);
 const initial:Snapshot={version:1,collection:'companies',watermark:new Timestamp(12,345),rows:[{id:'A',data:{updatedAt:new Timestamp(11,789)}}]};
 await files.save('companies',initial,'0');const loaded=await files.load('companies',undefined,timingOptions);
 const timing=timings.at(-1)!;
 assert.equal(timing.event,'entity_snapshot_file_read');assert.equal(timing.reason,'cold');assert.equal(timing.status,'success');
 assert.equal(timing.rowsDecoded,1);assert.equal(timing.bytesDownloaded,Buffer.byteLength(content));
 for(const key of ['metadataMs','downloadMs','processingMs','totalMs'])assert.ok(typeof timing[key]==='number'&&Number(timing[key])>=0,key);
 assert.equal(timing.timingsOverlap,true);assert.equal(timing.downloadIncludesBackpressure,true);
 assert.ok(Number(timing.totalMs)>=Number(timing.downloadMs));
 await files.load('companies',undefined,{log:()=>{throw Error('logging unavailable');}});
 assert.equal(JSON.parse(content).rows.length,1,'streamed file remains valid JSON');
 assert.equal(loaded.snapshot!.watermark.nanoseconds,345);
 assert.equal(loaded.snapshot!.rows[0].data.updatedAt.nanoseconds,789);
 const compact=await files.load('companies',row=>({id:row.id,data:{path:'/company/a'}}));
 assert.deepEqual(compact.snapshot!.rows,[{id:'A',data:{path:'/company/a'}}]);
 assert.deepEqual((await files.load('companies',()=>undefined)).snapshot!.rows,[]);
 await files.save('companies',{...initial,watermark:stamp(13)},loaded.generation);
 await assert.rejects(files.save('companies',initial,loaded.generation),/conflict/);
 assert.equal((await files.load('companies')).snapshot!.watermark.seconds,13);
 content=content.slice(0,content.lastIndexOf(']}'));
 await assert.rejects(files.load('companies',undefined,timingOptions),/Incomplete/);
 assert.equal(timings.at(-1)?.status,'error');assert.equal(timings.at(-1)?.rowsDecoded,1);
});


test('snapshot pages stop fetching when the consumer stops',async()=>{
 let calls=0;
 const query:Record<string,unknown>={};
 query.orderBy=query.limit=()=>query;
 query.get=async()=>{calls++;return {size:250,docs:Array.from({length:250},(_,i)=>({id:String(i),data:()=>({updatedAt:stamp(1)}),get:()=>stamp(1)}))};};
 const source=snapshotSource({collection:()=>query} as unknown as Firestore);
 for await(const page of source.pages!('eod_prices',undefined,stamp(2))){assert.equal(page.length,250);break;}
 assert.equal(calls,1);
});
