import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import {selectSecDiscoveryCompanies,registerSecDiscoveryCompanies} from '../../src/lib/sec-filings/discovery-schedule';
const META='sec_collector_state/_sec_filings_collector',now=Date.parse('2026-11-01T21:00:00Z');
type Data=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function fixture(ids:string[]=[]){
 const rows=new Map<string,Data>([[META,{discoveryCompanyIds:ids}]]),reads:string[]=[],writes:string[]=[],queries:unknown[][]=[];
 const value=(data:Data,name:string)=>name.split('.').reduce((v,k)=>v?.[k],data);
 const snap=(path:string)=>({id:path.split('/').at(-1)!,exists:rows.has(path),get:(key:string)=>value(rows.get(path)??{},key),data:()=>rows.get(path)});
 const set=(path:string,data:Data)=>{const next={...rows.get(path)};for(const [key,v] of Object.entries(data)){if(v?.constructor?.name==='DeleteTransform')delete next[key];else next[key]=v;}rows.set(path,next);writes.push(path);};
 const ref=(path:string)=>({path,get:async()=>{reads.push(path);return snap(path);},set:async(data:Data)=>set(path,data)});
 function query(collection:string,filters:Array<[string,string,unknown]>=[],orders:string[]=[],bound=Infinity,after?:ReturnType<typeof snap>):any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const matches=()=>[...rows].filter(([path,data])=>path.startsWith(collection+'/')&&orders.every(f=>f==='__name__'||value(data,f)!==undefined)&&filters.every(([field,op,wanted])=>{
   const actual=value(data,field);return actual!==undefined&&(op==='in'?(wanted as unknown[]).includes(actual):op==='<='?Number(actual)<=Number(wanted):actual===wanted);
  })).map(([path])=>snap(path)).sort((a,b)=>{for(const field of orders){const av=field==='__name__'?a.id:a.get(field),bv=field==='__name__'?b.id:b.get(field);if(av<bv)return -1;if(av>bv)return 1;}return 0;});
  return {doc:(id:string)=>ref(collection+'/'+id),where:(f:string,op:string,v:unknown)=>query(collection,[...filters,[f,op,v]],orders,bound,after),orderBy:(f:string|FieldPath)=>query(collection,filters,[...orders,typeof f==='string'?f:'__name__'],bound,after),limit:(n:number)=>query(collection,filters,orders,n,after),startAfter:(doc:ReturnType<typeof snap>)=>query(collection,filters,orders,bound,doc),
   count:()=>({get:async()=>({data:()=>({count:matches().length})})}),
   get:async()=>{queries.push(filters);let docs=matches();if(after)docs=docs.slice(docs.findIndex(doc=>doc.id===after.id)+1);docs=docs.slice(0,bound);for(const doc of docs)reads.push(collection+'/'+doc.id);return {docs,size:docs.length};}};
 }
 const db={collection:(name:string)=>query(name),runTransaction:async(fn:(tx:any)=>unknown)=>{ // eslint-disable-line @typescript-eslint/no-explicit-any
  const pending:Array<[string,Data]>=[];const result=await fn({get:async(r:{path:string})=>{reads.push(r.path);return snap(r.path);},set:(r:{path:string},data:Data)=>pending.push([r.path,data])});for(const [path,data] of pending)set(path,data);return result;
 }} as unknown as Firestore;
 const put=(id:string,data:Data)=>rows.set('sec_collector_state/_discovery_'+id.slice(3),data);
 return {db,rows,reads,writes,queries,put};
}

test('healthy future companies are not read; due and partial work are selected from the index',async()=>{
 const ids=Array.from({length:6174},(_,i)=>'US:C'+String(i).padStart(5,'0')),f=fixture(ids);
 for(const id of ids)f.put(id,{discoveryStatus:'complete',discoveryNextPollAtMs:now+3600000,discoveryCompleteAt:new Date(now-1000).toISOString()});
 f.put(ids[5],{discoveryStatus:'partial',discoveryNextPollAtMs:now-100});
 f.put(ids[9],{discoveryStatus:'complete',discoveryNextPollAtMs:now-50,discoveryCompleteAt:new Date(now-2000).toISOString()});
 const selected=await selectSecDiscoveryCompanies(f.db,ids,{now,maxCompanies:500});
 assert.deepEqual(selected.ids,[ids[5],ids[9]]);assert.equal(selected.statusDocumentsRead,2);
 assert.equal(f.reads.length,4,'one inventory, two selected statuses, one oldest completion');
 assert.equal(selected.freshness.remaining,1);assert.equal(f.writes.length,1,'only freshness summary; no per-company writes');
});

test('new companies with no document are registered in bounded slices without overwriting cursor or lock',async()=>{
 const f=fixture(),ids=['US:A','US:B','US:C','US:D'];
 f.put('US:A',{leaseOwner:'running',leaseExpiresAtMs:now+5000,afterCompanyId:'A',result:{completed:1}});
 const selected=await selectSecDiscoveryCompanies(f.db,ids,{now,maxCompanies:4});
 assert.equal(selected.registered,2);assert.equal(selected.unregistered,2);assert.deepEqual(selected.ids,['US:B']);
 assert.equal(f.rows.get('sec_collector_state/_discovery_A')?.leaseOwner,'running');
 assert.deepEqual(f.rows.get('sec_collector_state/_discovery_A')?.result,{completed:1});
 assert(selected.freshness.remaining>0);
 const next=await selectSecDiscoveryCompanies(f.db,ids,{now:now+6000,maxCompanies:4});
 assert.equal(next.unregistered,0);assert.deepEqual(next.ids,['US:A','US:B','US:C','US:D']);
});

test('pagination skips leased companies and still fills the batch; overdue rows are oldest first',async()=>{
 const ids=Array.from({length:300},(_,i)=>'US:C'+String(i).padStart(4,'0')),f=fixture(ids);
 ids.forEach((id,i)=>f.put(id,{discoveryStatus:'partial',discoveryNextPollAtMs:i,leaseExpiresAtMs:i<260?now+10000:0}));
 const selected=await selectSecDiscoveryCompanies(f.db,ids,{now,maxCompanies:30});
 assert.equal(selected.ids.length,30);assert.equal(selected.ids[0],ids[260]);assert(selected.statusDocumentsRead<=1000);
});

test('scope removals disable scheduling, preserve checkpoints, and re-enrollment queues work again',async()=>{
 const f=fixture(['US:A','US:B']);
 f.put('US:A',{discoveryStatus:'complete',discoveryNextPollAtMs:now+1000,discoveryCompleteAt:new Date(now-1000).toISOString()});
 f.put('US:B',{discoveryStatus:'partial',discoveryNextPollAtMs:0,afterCompanyId:'B'});
 await registerSecDiscoveryCompanies(f.db,['US:A'],10);
 assert.equal(f.rows.get('sec_collector_state/_discovery_B')?.discoveryStatus,'disabled');
 assert.equal(f.rows.get('sec_collector_state/_discovery_B')?.afterCompanyId,'B');
 assert.equal(f.rows.get('sec_collector_state/_discovery_B')?.discoveryNextPollAtMs,undefined);
 assert.deepEqual((await selectSecDiscoveryCompanies(f.db,['US:A','US:B'],{now,maxCompanies:10})).ids,['US:B']);
});

test('incomplete retries respect their retry deadline and cannot claim fresh coverage',async()=>{
 const f=fixture(['US:A']);f.put('US:A',{discoveryStatus:'partial',discoveryNextPollAtMs:now+60000});
 const first=await selectSecDiscoveryCompanies(f.db,['US:A'],{now,maxCompanies:10});
 assert.deepEqual(first.ids,[]);assert(first.freshness.remaining>0);
 assert.deepEqual((await selectSecDiscoveryCompanies(f.db,['US:A'],{now:now+60001,maxCompanies:10})).ids,['US:A']);
});
