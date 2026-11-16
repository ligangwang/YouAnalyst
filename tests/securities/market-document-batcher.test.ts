import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentBatcher} from '../../src/lib/market-store/document-batcher';
import {MarketRepository} from '../../src/lib/market-store/repository';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import type {MarketFiles,MarketRow} from '../../src/lib/market-store/files';

test('repository batches concurrent subscriptions without weakening generation invalidation',async()=>{
    let queries=0,generation=1;
    const raw={collection:()=>({where:()=>({onSnapshot:(next:(snapshot:unknown)=>void)=>{
        queueMicrotask(()=>next({docs:[],docChanges:()=>[],readTime:Timestamp.now()}));return()=>{};
    }})})} as unknown as Firestore;
    const files={query:async(_heads:unknown,steps:Array<{args:unknown[]}>)=>{
        queries++;return (steps[0].args[2] as string[]).map(id=>({id,data:{generation},version:Timestamp.now()}));
    },hydrate:async(row:MarketRow)=>row,close:async()=>{}} as unknown as MarketFiles;
    const repository=new MarketRepository(raw,files,undefined,true);
    try{
        const ids=Array.from({length:120},(_,i)=>String(i));
        const read=()=>Promise.all(ids.map(id=>repository.documents('company_fundamentals',[id])));
        const first=await read();assert.equal(queries,1);assert(first.every((rows,i)=>rows[0].id===ids[i]&&rows[0].data.generation===1));
        await read();assert.equal(queries,1);
        generation=2;repository.invalidate('company_fundamentals');
        const second=await read();assert.equal(queries,2);assert(second.every(rows=>rows[0].data.generation===2));
    }finally{await repository.close();}
});

test('concurrent ID subscriptions share one read and preserve ordering, duplicates and missing IDs',async()=>{
    const batcher=new DocumentBatcher<{id:string}>(),calls:string[][]=[];
    const read=async(ids:string[])=>{calls.push(ids);return ids.filter(id=>id!=='missing').reverse().map(id=>({id}));};
    const requests=Array.from({length:100},(_,i)=>[String(i),'shared',String(i),'missing']);
    const results=await Promise.all(requests.map(ids=>batcher.load('fundamentals:full',ids,read)));
    assert.equal(calls.length,1);assert.equal(calls[0].length,102);
    results.forEach((rows,i)=>assert.deepEqual(rows.map(row=>row.id),[String(i),'shared',String(i)]));
    await batcher.load('fundamentals:full',['shared'],read);assert.equal(calls.length,2,'batcher must not cache a previous generation');
});

test('projection and collection keys stay separate and each small-read batch is bounded',async()=>{
    const batcher=new DocumentBatcher<{id:string}>(3),calls:Array<{key:string;ids:string[]}>=[];
    const load=(key:string,ids:string[])=>batcher.load(key,ids,async ids=>{calls.push({key,ids});return ids.map(id=>({id}));});
    const result=await Promise.all([load('a:full',['1','2']),load('a:full',['3']),load('a:full',['4','5']),load('a:name',['1']),load('b:full',['1'])]);
    assert.equal(calls.length,4);assert(calls.every(call=>call.ids.length<=3));
    assert.deepEqual(result.map(rows=>rows.map(row=>row.id)),[['1','2'],['3'],['4','5'],['1'],['1']]);
});

test('a failed batch rejects every caller and allows a fresh retry',async()=>{
    const batcher=new DocumentBatcher<{id:string}>();let calls=0;
    const fail=async()=>{calls++;throw Error('read failed');};
    const results=await Promise.allSettled([batcher.load('a',['1'],fail),batcher.load('a',['2'],fail)]);
    assert.equal(calls,1);assert(results.every(result=>result.status==='rejected'&&result.reason.message==='read failed'));
    assert.deepEqual(await batcher.load('a',['1'],async()=>[{id:'1'}]),[{id:'1'}]);
});
