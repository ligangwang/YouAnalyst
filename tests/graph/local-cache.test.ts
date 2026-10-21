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
 for(let i=0;i<270;i++){const load=localDocuments(f.db,'companies',[String(i)]);f.listeners.at(-1)!.next({docs:[]});await load;}
 assert.equal(f.listeners[0].closed,false);assert.ok(f.listeners.filter(l=>l.closed).length>=2);
 f.listeners[0].next({docs:[f.doc('pending',1)]});assert.equal((await pending)![0].exists,true);
});


test('sitemap caches retain three buckets, share reads and push renames/removals', async t => {
 t.after(closeLocalCaches);
 const { loadSitemapPaths } = await import('../../src/lib/local-cache/sitemaps');
 const listeners: {prefix:string; next:(snapshot:unknown)=>void; closed:boolean}[]=[];
 const db={collection:()=>{let prefix='';const query={orderBy:()=>query,startAt:(p:string)=>{prefix=p;return query;},endBefore:()=>query,onSnapshot:(next:(snapshot:unknown)=>void)=>{const l={prefix,next,closed:false};listeners.push(l);return ()=>{l.closed=true;};}};return query;}} as unknown as Firestore;
 const doc=(id:string,name:string,slug:string)=>({id,data:()=>({name,slug,status:'PUBLISHED'})});
 const first=loadSitemapPaths(db,'US:M'),concurrent=loadSitemapPaths(db,'US:M');
 assert.equal(listeners.length,1);
 listeners[0].next({docs:[doc('US:MSFT','Microsoft','microsoft')]});
 const initial=await first;assert.deepEqual(await concurrent,initial);assert.ok(initial.length);assert.ok(Object.isFrozen(initial));
 for(const prefix of ['XSHG:6','ORG:']){const result=loadSitemapPaths(db,prefix);listeners.at(-1)!.next({docs:[]});await result;}
 assert.deepEqual(await loadSitemapPaths(db,'US:M'),initial);assert.equal(listeners.length,3);assert.ok(listeners.every(l=>!l.closed));
 listeners[0].next({docs:[doc('US:MSFT','Microsoft','microsoft-new')]});
 assert.notDeepEqual(await loadSitemapPaths(db,'US:M'),initial);
 listeners[0].next({docs:[]});assert.deepEqual(await loadSitemapPaths(db,'US:M'),[]);
 await assert.rejects(loadSitemapPaths(db,'arbitrary'),/Invalid sitemap prefix/);assert.equal(listeners.length,3);
 closeLocalCaches();assert.ok(listeners.every(l=>l.closed));
 const reopened=loadSitemapPaths(db,'US:M');assert.equal(listeners.length,4);listeners[3].next({docs:[]});await reopened;
});

test('fundamentals survive individual-company browsing and company-cache churn',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 for(let i=0;i<180;i++){
  const load=localDocuments(f.db,'company_fundamentals',[String(i)]);
  f.listeners.at(-1)!.next({docs:[f.doc(String(i),i)]});await load;
 }
 for(let i=0;i<70;i++){
  const load=localDocuments(f.db,'companies',[String(i)]);
  f.listeners.at(-1)!.next({docs:[]});await load;
 }
 const count=f.listeners.length;
 const result=await localDocuments(f.db,'company_fundamentals',['0','90','179']);
 assert.deepEqual(result!.map(d=>d.get('n')),[0,90,179]);assert.equal(f.listeners.length,count);
 f.listeners[0].next({docs:[f.doc('0',999)]});
 assert.equal((await localDocuments(f.db,'company_fundamentals',['0']))![0].get('n'),999);
 f.listeners[0].next({docs:[]});
 assert.equal((await localDocuments(f.db,'company_fundamentals',['0']))![0].exists,false);
 assert.equal(f.listeners.length,count);
 closeLocalCaches();
 const reopened=localDocuments(f.db,'company_fundamentals',['0']);
 assert.equal(f.listeners.length,count+1);f.listeners.at(-1)!.next({docs:[]});await reopened;
});

test('fundamentals capacity evicts idle groups but preserves a pending reader',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 const pending=localDocuments(f.db,'company_fundamentals',['pending']);
 for(let i=0;i<270;i++){
  const load=localDocuments(f.db,'company_fundamentals',[String(i)]);
  f.listeners.at(-1)!.next({docs:[]});await load;
 }
 assert.equal(f.listeners[0].closed,false);
 assert.ok(f.listeners.filter(l=>!l.closed).length<=256);
 f.listeners[0].next({docs:[f.doc('pending',1)]});await pending;
});

test('fundamentals memory budget releases large idle snapshots',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 for(let i=0;i<20;i++){
  const load=localDocuments(f.db,'company_fundamentals',[String(i)]);
  f.listeners.at(-1)!.next({docs:[{id:String(i),data:()=>({text:'x'.repeat(900_000)})}]});await load;
 }
 assert.ok(f.listeners.some(l=>l.closed),'memory bound applies before group capacity');
});


test('company ID cache retains a supported-company browsing cycle',async t=>{
 t.after(closeLocalCaches);const f=fixture();
 for(let i=0;i<180;i++){
  const load=localDocuments(f.db,'companies',[String(i)]);
  f.listeners.at(-1)!.next({docs:[f.doc(String(i),i)]});await load;
 }
 for(let visit=0;visit<3;visit++)for(let i=0;i<180;i++){
  assert.equal((await localDocuments(f.db,'companies',[String(i)]))![0].get('n'),i);
 }
 assert.equal(f.listeners.length,180);
});
