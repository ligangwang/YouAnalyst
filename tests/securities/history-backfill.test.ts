import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earningsFirestore } from '../helpers/earnings-firestore';
import type { Bucket } from '@google-cloud/storage';
import { backfillPriceHistory, historyBars, historyThrough, historyProviderSymbol } from '../../src/lib/predictions/history-backfill';

const bar=(date:string)=>({date,open:10,high:12,low:9,close:11,adjusted_close:10.5,volume:100});
function fixture() {
  const f=earningsFirestore(),docs=f.rows,db=f.db;
  const files=new Map<string,string>();
  const bucket={file:(name:string)=>({name,download:async()=>{if(!files.has(name))throw {code:404};return [Buffer.from(files.get(name)!)];},save:async(value:string)=>{files.set(name,value);}})} as unknown as Bucket;
  return {db,bucket,docs,files,queries:f.queries,setFail:(value:boolean)=>f.reject(path=>value&&path.startsWith('eod_prices/'))};
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
for(const createFirst of [false,true])test(`new mapped stocks fetch once, preserve prices and deduplicate repeated enrollment (createFirst=${createFirst})`,async()=>{
  const f=fixture();let calls=0;
  f.docs.set('eod_prices/US_MU_2025-12-31',{close:99});
  const input={...f,createFirst,tickers:['MU','MU'],through:'2026-10-05',token:'test',apiUrl:'https://prices.example.org',fetcher:async(url: string | URL | Request)=>{calls++;assert.equal(new URL(String(url)).hostname,'prices.example.org');return new Response(JSON.stringify([bar('2025-12-31'),bar('2026-01-02')]));}};
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

test('onboarding history has its own 2020 range receipt and bounded write batches',async()=>{
  const f=fixture();let calls=0,batches=0;
  f.docs.set('collectors/eod-history_US_MU',{from:'2025-12-31',status:'completed'});
  const input={...f,tickers:['MU'],from:'2020-12-30',through:'2026-10-05',token:'test',writeBatchSize:1,
    afterBatch:async()=>{batches++;},fetcher:async(url:string|URL|Request)=>{
      calls++;assert.equal(new URL(String(url)).searchParams.get('from'),'2020-12-30');
      return new Response(JSON.stringify([bar('2020-12-30'),bar('2020-12-31')]));
    }};
  const result=await backfillPriceHistory(input);
  assert.equal(result.completed,1);assert.equal(result.created,2);assert.equal(batches,2);
  assert.equal(f.docs.get('collectors/eod-history_US_MU_2020-12-30_2026-10-05')?.from,'2020-12-30');
  assert.equal(f.docs.get('collectors/eod-history_US_MU')?.from,'2025-12-31');
  assert.equal((await backfillPriceHistory(input)).skipped,1);assert.equal(calls,1);
});

test('a full-history sized onboarding batch creates 1500 records in one checkpoint',async()=>{
  const f=fixture();let batches=0;
  const bars=Array.from({length:1500},(_,i)=>bar(new Date(Date.parse('2020-12-30T00:00:00Z')+i*86400000).toISOString().slice(0,10)));
  const result=await backfillPriceHistory({...f,tickers:['MU'],from:'2020-12-30',through:bars.at(-1)!.date,token:'test',writeBatchSize:1500,createFirst:true,
    afterBatch:async()=>{batches++;},fetcher:async()=>new Response(JSON.stringify(bars))});
  assert.equal(result.completed,1);assert.equal(result.created,1500);assert.equal(batches,1);
  assert.equal(f.queries.length,0,'fresh onboarding skips all price existence queries');
});
