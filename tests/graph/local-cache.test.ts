import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { localDocuments, localEntityVersions } from '../../src/lib/local-cache/entities';
import { Watch, closeLocalCaches } from '../../src/lib/local-cache/watch';
function fixture(){
 const listeners:{collection:string;ids:string[];next:(snapshot:unknown)=>void;closed:boolean}[]=[];
 const db={collection:(collection:string)=>{let ids:string[]=[];const query={where:(_field:unknown,_op:string,value:string[])=>{ids=value;return query;},doc:(id:string)=>({id}),onSnapshot:(next:(snapshot:unknown)=>void)=>{const listener={collection,ids,next,closed:false};listeners.push(listener);return ()=>{listener.closed=true;};}};return query;}} as unknown as Firestore;
 const doc=(id:string,n:number)=>({id,exists:true,get:()=>n,data:()=>({n})});
 return {db,listeners,doc};
}
test('concurrent overlapping ID lists share initial loads, updates and deletions are pushed',async(t)=>{
 t.after(closeLocalCaches);const f=fixture();
 const a=localDocuments(f.db,'company_fundamentals',['A','B']),b=localDocuments(f.db,'company_fundamentals',['B','C']);
 assert.equal(f.listeners.length,2);assert.deepEqual(f.listeners.map(l=>l.ids),[['A','B'],['C']]);
 f.listeners[0].next({docs:[f.doc('A',1),f.doc('B',2)]});f.listeners[1].next({docs:[f.doc('C',3)]});
 assert.deepEqual((await a)!.map(d=>d.id),['A','B']);assert.deepEqual((await b)!.map(d=>d.id),['B','C']);
 const before=localEntityVersions(f.db).company_fundamentals;
 f.listeners[0].next({docs:[f.doc('B',4)]});
 assert.notEqual(localEntityVersions(f.db).company_fundamentals,before);
 const result=await localDocuments(f.db,'company_fundamentals',['A','B']);assert.equal(result![0].exists,false);assert.equal(result![1].get('n'),4);assert.equal(f.listeners.length,2);
});
test('independent instances receive their own push updates',async(t)=>{
 t.after(closeLocalCaches);const a=fixture(),b=fixture();const reads=[localDocuments(a.db,'companies',['A']),localDocuments(b.db,'companies',['A'])];
 for(const f of [a,b])f.listeners[0].next({docs:[f.doc('A',1)]});await Promise.all(reads);
 for(const f of [a,b]){f.listeners[0].next({docs:[f.doc('A',2)]});assert.equal((await localDocuments(f.db,'companies',['A']))![0].get('n'),2);}
});
test('listener failure retains last good data instead of triggering a Firestore fallback',async()=>{
 let next!:(n:number)=>void,error!:(e:Error)=>void;
 const watch=new Watch<number>((n,e)=>{next=n;error=e;return ()=>{};});
 next(7);assert.equal(await watch.read(),7);error(Error('offline'));assert.equal(await watch.read(),7);watch.close();
});
test('cold listener failure rejects readers and does not fabricate an empty cache',async()=>{
 let error!:(e:Error)=>void;const watch=new Watch<number>((_n,e)=>{error=e;return ()=>{};});
 const result=watch.read();error(Error('denied'));await assert.rejects(result,/denied/);watch.close();
});
test('subscriptions are bounded and eviction never cancels an active initial load',async(t)=>{
 t.after(closeLocalCaches);const f=fixture();const pending=localDocuments(f.db,'companies',['pending']);
 for(let i=0;i<66;i++){const load=localDocuments(f.db,'companies',[String(i)]);f.listeners.at(-1)!.next({docs:[]});await load;}
 assert.equal(f.listeners[0].closed,false);assert.ok(f.listeners.filter(l=>l.closed).length>=2);
 f.listeners[0].next({docs:[f.doc('pending',1)]});assert.equal((await pending)![0].exists,true);
});
