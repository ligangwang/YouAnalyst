import test from 'node:test';
import assert from 'node:assert/strict';
import {startMarketReadTiming} from '../../src/lib/market-read-timing';
import {withDuck} from '../../src/lib/price-store/parquet';

test('slow read timings separate wait from work and omit values',()=>{
 let clock=100;const entries:Record<string,unknown>[]=[];
 const timing=startMarketReadTiming('duckdb',undefined,{enabled:true,now:()=>clock,sink:entry=>entries.push(entry)})!;
 clock=1600;timing.workStarted();clock=1700;timing.workStarted();clock=1800;timing.finish('success');timing.finish('success');
 assert.equal(entries.length,1);
 assert.equal(entries[0].waitMs,1500);assert.equal(entries[0].workMs,200);assert.equal(entries[0].durationMs,1700);
 assert.equal(entries[0].waitPhase,'queue');assert.equal(entries[0].status,'success');
 assert(!('query' in entries[0]));assert(!('paths' in entries[0]));
 const files=startMarketReadTiming('files',16,{enabled:true,now:()=>clock,sink:entry=>entries.push(entry)})!;
 clock+=1200;files.finish('error');
 assert.equal(entries[1].waitPhase,'file_acquisition');assert.equal(entries[1].waitMs,1200);assert.equal(entries[1].workMs,0);
 assert.equal(entries[1].workStarted,false);assert.equal(entries[1].fileCount,16);
});

test('fast and disabled reads stay quiet and a broken sink cannot fail work',()=>{
 let clock=0;const sink=()=>{throw Error('Unavailable logging');};
 assert.equal(startMarketReadTiming('files',1,{enabled:false,sink}),undefined);
 const fast=startMarketReadTiming('files',1,{enabled:true,now:()=>clock,sink})!;
 clock=999;assert.doesNotThrow(()=>fast.finish('success'));
 const slow=startMarketReadTiming('duckdb',undefined,{enabled:true,now:()=>clock,sink})!;
 clock=2000;assert.doesNotThrow(()=>slow.finish('error'));
});

test('timed DuckDB queue preserves failures and continues serialized work',async()=>{
 const order:string[]=[];const failure=Error('Expected callback failure');
 const first=withDuck(async()=>{order.push('first');throw failure;});
 const second=withDuck(async db=>{order.push('second');return (await db.runAndReadAll('SELECT 42')).getRows();});
 await assert.rejects(first,error=>error===failure);
 assert.deepEqual(await second,[[42]]);assert.deepEqual(order,['first','second']);
});
