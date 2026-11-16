import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('completed jobs close control and shard streams and can create a fresh client',async()=>{
    const source=`
        const assert=require('node:assert/strict');
        const {Timestamp}=require('firebase-admin/firestore');
        const {enableMarketStore}=require('./src/lib/market-store/runtime.ts');
        const {closeLocalCaches}=require('./src/lib/local-cache/watch.ts');
        (async()=>{
        let closed=0;
        const listen=(callback,value)=>{const timer=setInterval(()=>{},1000);queueMicrotask(()=>callback(value));return ()=>{clearInterval(timer);closed++;};};
        const raw={doc:()=>({onSnapshot:callback=>listen(callback,{data:()=>({version:1,ready:false})})}),collection:()=>({where:()=>({onSnapshot:callback=>listen(callback,{docs:[],docChanges:()=>[],readTime:Timestamp.now()})})})};
        const bucket={name:'shutdown-fixture'};
        const first=enableMarketStore(raw,bucket);
        assert.equal(enableMarketStore(raw,bucket),first);
        await [...globalThis.__youAnalystMarketStore.repositories][0].heads('events');
        const closing=closeLocalCaches();
        assert.equal(closed,2,'shutdown releases streams synchronously');
        const second=enableMarketStore(raw,bucket);
        assert.notEqual(second,first,'closed clients must not be reused');
        await closing;
        assert.equal(closed,2,'an earlier cleanup must not close a later client');
        await closeLocalCaches();
        assert.equal(closed,3);
        console.log('job exited with all streams closed');
        })().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const result=await promisify(execFile)(process.execPath,['--import','tsx','-e',source],{
        cwd:process.cwd(),env:{...process.env,MARKET_PARQUET_ENABLED:'1'},timeout:15000,windowsHide:true,
    });
    assert.match(result.stdout,/job exited with all streams closed/);
});
