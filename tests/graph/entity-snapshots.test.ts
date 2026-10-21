import assert from 'node:assert/strict';
import test from 'node:test';
import {Timestamp,FieldValue,type Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {snapshotFiles} from '../../src/lib/entity-snapshots/storage';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {syncCollection,collections,type Files,type Source,type Snapshot,type Row} from '../../src/lib/entity-snapshots/sync';
import {entityPatch,lifecycleFields} from '../../src/lib/entity-snapshots/lifecycle';
const stamp=(n:number)=>new Timestamp(n,0);
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
   download:async()=>{assert.equal(options?.generation,String(generation));return [Buffer.from(content)];},
   save:async(text:string,config:{preconditionOpts:{ifGenerationMatch:string}})=>{
     if(config.preconditionOpts.ifGenerationMatch!==String(generation))throw Object.assign(Error('conflict'),{code:412});
     content=text;generation++;
   },
 })} as unknown as Bucket;
 const files=snapshotFiles(bucket);
 assert.equal((await files.load('companies')).generation,'0');
 const initial:Snapshot={version:1,collection:'companies',watermark:new Timestamp(12,345),rows:[{id:'A',data:{updatedAt:new Timestamp(11,789)}}]};
 await files.save('companies',initial,'0');const loaded=await files.load('companies');
 assert.equal(loaded.snapshot!.watermark.nanoseconds,345);
 assert.equal(loaded.snapshot!.rows[0].data.updatedAt.nanoseconds,789);
 await files.save('companies',{...initial,watermark:stamp(13)},loaded.generation);
 await assert.rejects(files.save('companies',initial,loaded.generation),/conflict/);
 assert.equal((await files.load('companies')).snapshot!.watermark.seconds,13);
});
