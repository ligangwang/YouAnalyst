import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentReference,DocumentSnapshot} from 'firebase-admin/firestore';
import {RetainedReadCache} from '../../src/lib/market-store/retained-read-cache';
import {shardFor} from '../../src/lib/market-store/files';

const ref=(id:string)=>({id,path:'company_fundamentals/'+id,parent:{id:'company_fundamentals'}}) as DocumentReference;
const doc=(ref:DocumentReference,generation=1)=>({id:ref.id,ref,exists:true,data:()=>({generation})}) as unknown as DocumentSnapshot;

test('overlapping broad queries reuse unchanged documents and refresh only changed shards',async()=>{
    const cache=new RetainedReadCache(),refs=Array.from({length:11730},(_,i)=>ref('US:'+i));
    let count=0,generation=1;
    const load=async(refs:DocumentReference[])=>{count+=refs.length;return refs.map(ref=>doc(ref,generation));};
    await cache.read(refs,undefined,load);assert.equal(count,11730);
    generation=2;const shard=shardFor(refs[0].id);cache.invalidate('company_fundamentals',new Set([shard]));
    const next=await cache.read([...refs].reverse(),undefined,load);
    assert.equal(count,11730+refs.filter(ref=>shardFor(ref.id)===shard).length);
    next.forEach(row=>assert.equal(row.data()!.generation,shardFor(row.id)===shard?2:1));
});

test('invalidation during an in-flight read cannot repopulate a stale generation',async()=>{
    const cache=new RetainedReadCache();let finish!:(docs:DocumentSnapshot[])=>void;
    const r=ref('US:A'),old=cache.read([r],undefined,()=>new Promise(resolve=>{finish=resolve;}));
    cache.invalidate('company_fundamentals',new Set([shardFor(r.id)]));
    const current=await cache.read([r],undefined,async()=>[doc(r,2)]);
    finish([doc(r,1)]);await old;
    assert.equal((await cache.read([r],undefined,async()=>{throw Error('unexpected read');}))[0],current[0]);
});

test('masks, TTL, failed loads and memory eviction cannot serve inappropriate cached data',async()=>{
    let now=0,calls=0;const cache=new RetainedReadCache(4096,()=>now),r=ref('US:A');
    const load=async(refs:DocumentReference[])=>{calls++;return refs.map(ref=>doc(ref,calls));};
    await cache.read([r,r],['a'],load);assert.equal(calls,1);
    await cache.read([r],undefined,load);assert.equal(calls,2);
    now=60001;await cache.read([r],undefined,load);assert.equal(calls,3);
    cache.invalidate();await assert.rejects(cache.read([r],undefined,async()=>{throw Error('offline');}),/offline/);
    await cache.read([r],undefined,load);assert.equal(calls,4);
    await cache.read([ref('US:B')],undefined,async refs=>refs.map(ref=>({...doc(ref),data:()=>({large:'x'.repeat(5000)})}) as unknown as DocumentSnapshot));
    await cache.read([r],undefined,load);assert.equal(calls,5);
});
