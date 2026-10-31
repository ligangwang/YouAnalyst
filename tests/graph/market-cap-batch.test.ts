import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {loadCompanyDocuments} from '../../src/lib/company-document-cache';
import {localEntityVersions} from '../../src/lib/local-cache/entities';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';

function fixture(){
 const values=new Map<string,Record<string,unknown>>();
 const reads:string[][]=[];
 let gate=Promise.resolve();
 let failure=false;
 type Listener={ids:string[];closed:boolean;next:(value:unknown)=>void};
 const listeners:Listener[]=[];
 const stamp=(time:number)=>Timestamp.fromMillis(time);
 const doc=(id:string,time:number,data=values.get(id))=>({id,exists:data!==undefined,ref:{id,path:`company_fundamentals/${id}`},readTime:stamp(time),data:()=>data,get:(key:string)=>data?.[key]});
 const raw={collection:(name:string)=>{
  assert.equal(name,'company_fundamentals','never request unrelated collections or files');
  const query={path:name,doc:(id:string)=>({id,path:`${name}/${id}`}),
   where:(_field:unknown,operator:string,ids:string[])=>{assert.equal(operator,'in');assert(ids.length<=30);return {onSnapshot:(next:Listener['next'])=>{const listener={ids,closed:false,next};listeners.push(listener);return ()=>{listener.closed=true;};}};},
   onSnapshot:()=>{throw Error('whole-collection listener forbidden');}};
  return query;
 },getAll:async(...args:unknown[])=>{
  assert.deepEqual(args.pop(),{fieldMask:['marketCap','isDeleted']});
  const ids=(args as {id:string}[]).map(ref=>ref.id);assert(ids.length<=1000);reads.push(ids);
  if(failure)throw Error('bulk unavailable');
  const result=ids.map(id=>doc(id,100,structuredClone(values.get(id))));
  await gate;return result;
 }} as unknown as Firestore;
 const db=observeFirestore(raw,()=>{});
 return {db,values,reads,listeners,doc,
  fail:(value:boolean)=>{failure=value;},
  hold:()=>{let release!:()=>void;gate=new Promise<void>(resolve=>{release=resolve;});return release;},
  emit:(listener:Listener,time:number)=>listener.next({readTime:stamp(time),docs:listener.ids.filter(id=>values.has(id)).map(id=>doc(id,time))})};
}
const read=(db:Firestore,ids:string[])=>loadCompanyDocuments(db,'company_fundamentals',ids,'marketCap');

test('908 requested IDs use one projected bulk fetch, no file/collection scan, and warm reads reuse it',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 enableCompanyDirectory(f.db,f.db,{file:async()=>{throw Error('snapshot download forbidden');}});
 const ids=Array.from({length:908},(_,i)=>`US:C${i}`);
 for(const id of ids)f.values.set(id,{marketCap:{value:1}});
 f.values.set('US:UNRELATED',{marketCap:{value:999}});
 const [us,cn]=await Promise.all([read(f.db,ids.slice(0,759)),read(f.db,ids.slice(759))]);
 assert.deepEqual(f.reads,[ids]);assert.equal(us.length+cn.length,908);
 assert(f.listeners.every(listener=>listener.ids.every(id=>ids.includes(id))));
 assert.equal((await read(f.db,[ids[900],ids[0]]))[0].id,ids[900]);
 assert.equal(f.reads.length,1);
});

test('1001 requested companies split into 1000 and 1; duplicate IDs retain caller order',async t=>{
 t.after(closeLocalCaches);const f=fixture();const ids=Array.from({length:1001},(_,i)=>`US:C${i}`);
 const result=await read(f.db,[...ids,ids[0]]);
 assert.deepEqual(f.reads.map(ids=>ids.length),[1000,1]);
 assert.deepEqual(result.map(doc=>doc.id),[...ids,ids[0]]);
 assert(result.every(doc=>!doc.exists));
});

test('overlapping requests share reads; handoff catches writes, creations and deletions without stale rollback',async t=>{
 t.after(closeLocalCaches);const f=fixture();f.values.set('A',{marketCap:{value:1}});
 const release=f.hold();
 const a=read(f.db,['A','B']),b=read(f.db,['B','A']);
 await new Promise<void>(resolve=>queueMicrotask(resolve));
 f.values.set('A',{marketCap:{value:2}});f.values.set('B',{marketCap:{value:3}});
 release();await Promise.all([a,b]);assert.deepEqual(f.reads,[['A','B']]);
 const before=localEntityVersions(f.db).company_fundamentals;
 f.emit(f.listeners[0],200);
 const current=await read(f.db,['B','A']);
 assert.deepEqual(current.map(doc=>doc.get('marketCap')),[{value:3},{value:2}]);
 assert.notEqual(localEntityVersions(f.db).company_fundamentals,before);
 f.listeners[0].next({readTime:Timestamp.fromMillis(150),docs:[]});
 assert.equal((await read(f.db,['A']))[0].exists,true,'late old snapshot cannot delete newer data');
 f.values.delete('A');f.values.set('B',{isDeleted:true,marketCap:{value:3}});f.emit(f.listeners[0],300);
 assert((await read(f.db,['A','B'])).every(doc=>!doc.exists));
 f.values.set('A',{marketCap:{value:4}});f.emit(f.listeners[0],400);
 const cap=(await read(f.db,['A']))[0].get('marketCap');cap.value=999;
 assert.equal((await read(f.db,['A']))[0].get('marketCap').value,4);
 assert.equal(f.reads.length,1);
});

test('failed bulk reads reject rather than cache emptiness; closed caches can reload',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 t.mock.method(console,'warn',()=>{});f.fail(true);
 await assert.rejects(read(f.db,['A']),/bulk unavailable/);
 assert.equal(f.listeners.length,0);
 closeLocalCaches();f.fail(false);f.values.set('A',{marketCap:{value:5}});
 assert.equal((await read(f.db,['A']))[0].get('marketCap').value,5);
 assert.equal(f.reads.length,2);closeLocalCaches();
 assert(f.listeners.every(listener=>listener.closed));
 // Delayed callbacks from retired listeners cannot replace the new cache.
 await read(f.db,['A']);f.values.set('A',{marketCap:{value:999}});f.emit(f.listeners[0],300);
 assert.equal((await read(f.db,['A']))[0].get('marketCap').value,5);
});

test('projected cache does not satisfy full fundamentals reads or evict their data',async t=>{
 t.after(closeLocalCaches);const f=fixture();f.values.set('A',{marketCap:{value:1},annual:{revenue:100}});
 await read(f.db,['A']);
 const full=loadCompanyDocuments(f.db,'company_fundamentals',['A']);
 f.emit(f.listeners.at(-1)!,200);
 assert.deepEqual((await full)[0].get('annual'),{revenue:100});
 f.values.set('A',{marketCap:{value:2},annual:{revenue:200}});
 f.emit(f.listeners[0],300);f.emit(f.listeners[1],300);
 assert.equal((await read(f.db,['A']))[0].get('annual'),undefined);
 assert.deepEqual((await loadCompanyDocuments(f.db,'company_fundamentals',['A']))[0].get('annual'),{revenue:200});
});
