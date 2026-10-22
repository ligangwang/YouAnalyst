import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp,Firestore} from 'firebase-admin/firestore';
import {EntitySync,type ChangeBatch} from '../../src/lib/local-cache/entity-sync';
import {enableCompanyDirectory,companyDirectory} from '../../src/lib/local-cache/company-directory';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import type {EntityRows} from '../../src/lib/entity-snapshots/sqlite';
const stamp=(n:number)=>new Timestamp(n,0);
const batch=(n:number,id='x'):ChangeBatch=>({readTime:stamp(n),changes:[{id,data:{updatedAt:stamp(n),value:n}}]});
test('initial catch-up, live IDs, inclusive reconnect, and stale callbacks',async()=>{
 const connections:{since:Timestamp;next:(b:ChangeBatch)=>void;error:(e:Error)=>void;closed:boolean}[]=[];
 let reconnected!:()=>void;const reconnect=new Promise<void>(resolve=>{reconnected=resolve;});
 const applied:string[]=[];
 const sync=new EntitySync((since,next,error)=>{const connection={since,next,error,closed:false};connections.push(connection);if(connections.length===2)reconnected();return()=>{connection.closed=true;};},stamp(10),changes=>{applied.push(...changes.map(row=>row.id));},1);
 try{
  connections[0].next(batch(11,'initial'));await sync.ready();
  connections[0].next(batch(12,'live'));connections[0].error(Error('disconnected'));
  // Keep the event loop alive while the unref'ed reconnect timer runs.
  await Promise.race([reconnect,new Promise((_,reject)=>setTimeout(()=>reject(Error('No reconnect')),100))]);
  assert.equal(connections[0].closed,true);assert.equal(connections[1].since.seconds,12);
  connections[0].next(batch(99,'stale'));connections[1].next(batch(13,'gap'));await sync.ready();
  assert.deepEqual(applied,['initial','live','gap']);
 }finally{sync.close();}
});
test('failed apply does not advance the resume boundary',async()=>{
 const boundaries:number[]=[];let callback!:(batch:ChangeBatch)=>void;let reconnect!:()=>void;
 const connected=new Promise<void>(resolve=>{reconnect=resolve;});let fail=true;
 const sync=new EntitySync((since,next)=>{boundaries.push(since.seconds);callback=next;if(boundaries.length===2)reconnect();return()=>{};},stamp(10),()=>{if(fail)throw Error('apply failed');},1);
 try{
  callback(batch(20));await assert.rejects(sync.ready(),/apply failed/);fail=false;
  await Promise.race([connected,new Promise((_,reject)=>setTimeout(()=>reject(Error('No reconnect')),100))]);
  assert.deepEqual(boundaries,[10,10]);callback(batch(20));await sync.ready();
 }finally{sync.close();}
});
for(const collection of ['companies','instruments','company_fundamentals','company_relationships'] as const){
 test(`${collection}: startup changes and live soft deletes override an old file`,async()=>{
  const rows:EntityRows=new Map([['a',{value:1,updatedAt:stamp(1)}]]);rows.watermark=stamp(1);
  let next!:(batch:ChangeBatch)=>void;let time=0;let sync!:EntitySync;
  const sdk=new Firestore({projectId:'sync-'+collection}),db=observeFirestore(sdk,()=>{});
  enableCompanyDirectory(db,{} as Firestore,{file:async()=>Object.assign(new Map(rows),{watermark:rows.watermark}) as EntityRows,now:()=>time,
   sync:(_db,_collection,since,apply)=>sync=new EntitySync((_since,callback)=>{next=callback;queueMicrotask(()=>callback({readTime:stamp(3),changes:[{id:'a',data:{value:3,updatedAt:stamp(3)}},{id:'b',data:{value:2,updatedAt:stamp(2)}}]}));return()=>{};},since,apply)});
  try{
   const initial=await companyDirectory(db,collection);
   assert.equal(initial.get('a')?.value,3);assert.equal(initial.get('b')?.value,2);
   next({readTime:stamp(4),changes:[{id:'a',data:{isDeleted:true,updatedAt:stamp(4)}}]});
   assert.equal((await db.collection(collection).doc('a').get()).exists,false);
   time=86_400_001;
   assert.equal((await db.collection(collection).doc('a').get()).exists,false);
   assert.equal((await db.collection(collection).doc('b').get()).get('value'),2);
   // Delayed older notifications must not undo a newer local/live value.
   next({readTime:stamp(5),changes:[{id:'a',data:{value:1,updatedAt:stamp(1)}}]});
   assert.equal((await db.collection(collection).doc('a').get()).exists,false);
  }finally{sync?.close();}

 });
}
