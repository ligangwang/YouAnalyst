import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { backfillPriceHistory, historyBars, historyThrough, historyProviderSymbol } from '../../src/lib/predictions/history-backfill';

const bar=(date:string)=>({date,open:10,high:12,low:9,close:11,adjusted_close:10.5,volume:100});
function fixture() {
  const docs=new Map<string,Record<string,unknown>>();
  const files=new Map<string,string>();
  let failWrite=false;
  const ref=(id:string)=>({id,get:async()=>({exists:docs.has(id),data:()=>docs.get(id)}),create:async(value:Record<string,unknown>)=>{
    if(failWrite)throw Error('write failed');if(docs.has(id))throw {code:6};docs.set(id,value);
  }});
  const db={collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`)}),
    getAll:async(...refs:ReturnType<typeof ref>[])=>Promise.all(refs.map(r=>r.get())),
    runTransaction:async(fn:(tx:unknown)=>unknown)=>fn({get:(r:ReturnType<typeof ref>)=>r.get(),set:(r:ReturnType<typeof ref>,value:Record<string,unknown>)=>docs.set(r.id,{...docs.get(r.id),...value})})} as unknown as Firestore;
  const bucket={file:(name:string)=>({name,download:async()=>{if(!files.has(name))throw {code:404};return [Buffer.from(files.get(name)!)];},save:async(value:string)=>{files.set(name,value);}})} as unknown as Bucket;
  return {db,bucket,docs,files,setFail:(value:boolean)=>{failWrite=value;}};
}
test('history validation rejects malformed dates, duplicate bars and invalid prices',()=>{
  assert.throws(()=>historyBars([bar('2026-02-30')],'2025-12-31','2026-10-05'));
  assert.throws(()=>historyBars([bar('2026-01-02'),bar('2026-01-02')],'2025-12-31','2026-10-05'));
  assert.throws(()=>historyBars([{...bar('2026-01-02'),close:-1}],'2025-12-31','2026-10-05'));
  assert.equal(historyBars([bar('2026-01-02')],'2025-12-31','2026-10-05')[0].adjusted_close,10.5);
});
test('history cutoff excludes unfinished sessions in each market timezone',()=>{
  assert.equal(historyProviderSymbol('MOG.A'),'MOG-A.US');
  assert.equal(historyProviderSymbol('XSHG:600000'),'600000.SHG');
  const now=new Date('2026-10-06T16:00:00Z');
  assert.equal(historyThrough('US',now),'2026-10-05');
  assert.equal(historyThrough('CN_A',now),'2026-10-06');
});
test('new mapped stocks fetch once, preserve prices and deduplicate repeated enrollment',async()=>{
  const f=fixture();let calls=0;
  f.docs.set('eod_prices/US_MU_2025-12-31',{close:99});
  const input={...f,tickers:['MU','MU'],through:'2026-10-05',token:'test',fetcher:async()=>{calls++;return new Response(JSON.stringify([bar('2025-12-31'),bar('2026-01-02')]));}};
  const result=await backfillPriceHistory(input);
  assert.equal(result.created,1);assert.equal(result.existing,1);assert.equal(calls,1);
  assert.equal(f.docs.get('eod_prices/US_MU_2025-12-31')?.close,99);
  assert.equal(f.docs.get('eod_prices/US_MU_2026-01-02')?.adjustedClose,10.5);
  const again=await backfillPriceHistory(input);assert.equal(again.skipped,1);assert.equal(calls,1);
});
test('a failed write resumes from raw cache without another provider call',async()=>{
  const f=fixture();let clock=Date.now(),calls=0;
  const input={...f,tickers:['MU'],through:'2026-10-05',token:'test',now:()=>clock,fetcher:async()=>{calls++;return new Response(JSON.stringify([bar('2026-01-02')]));}};
  f.setFail(true);assert.equal((await backfillPriceHistory(input)).failures.length,1);
  clock+=86400001;f.setFail(false);
  assert.equal((await backfillPriceHistory(input)).completed,1);assert.equal(calls,1);
});
