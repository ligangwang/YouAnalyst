import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedOperatorWork} from '../../scripts/lib/bounded-operator-work';
test('operator pages respect their concurrency bound and finish all writes',async()=>{
    let active=0,maximum=0;const done:number[]=[];
    await boundedOperatorWork(Array.from({length:23},(_,n)=>n),4,async n=>{
        active++;maximum=Math.max(maximum,active);
        await new Promise(resolve=>setTimeout(resolve,2));done.push(n);active--;
    });
    assert.equal(maximum,4);assert.equal(active,0);assert.equal(done.length,23);
});
test('operator failure stops further admission and waits for in-flight pages',async()=>{
    const started:number[]=[],finished:number[]=[];
    await assert.rejects(boundedOperatorWork([0,1,2,3,4,5],2,async n=>{
        started.push(n);await new Promise(resolve=>setTimeout(resolve,n?10:1));
        if(n===0)throw Error('capacity');finished.push(n);
    }),/capacity/);
    assert.deepEqual(started,[0,1]);assert.deepEqual(finished,[1]);
});
