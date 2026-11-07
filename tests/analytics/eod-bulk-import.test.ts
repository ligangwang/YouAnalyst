import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as admin from 'firebase-admin';
import {getStorage} from 'firebase-admin/storage';
import {persistBulkEodPrices,persistDailyBulkEodPrices} from '../../src/lib/predictions/eod-prices';
import {withEodWorkScope} from '../../src/lib/predictions/eod-work-scope';
import {pubsubFirestore} from '../helpers/pubsub-firestore';

test('daily coverage checks 1000 absent symbols without individual provider calls',async t=>{
 const f=pubsubFirestore(),ids=Array.from({length:1000},(_,i)=>`US:T${i}`);
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('Daily coverage must not call the provider');});
 assert.deepEqual(await persistDailyBulkEodPrices({market:'US',runDate:'2026-11-06'},ids,true,f.db),ids);
 assert.equal(fetch.mock.callCount(),0);
});

test('bulk cleanup advances past absent provider symbols but retries outages',async t=>{
 const before=process.env.EODHD_API_TOKEN;process.env.EODHD_API_TOKEN='synthetic';
 t.after(()=>{if(before===undefined)delete process.env.EODHD_API_TOKEN;else process.env.EODHD_API_TOKEN=before;});
 const f=pubsubFirestore();let status=404;let rows:unknown=[];
 t.mock.method(globalThis,'fetch',async()=>status===200?Response.json(rows):new Response('',{status}));
 const input={market:'US' as const,runDate:'2026-11-06'};
 assert.deepEqual(await persistBulkEodPrices(input,['US:EONR.WT'],true,f.db),['US:EONR.WT']);
 for(status of [401,429,500])await assert.rejects(persistBulkEodPrices(input,['US:EONR.WT'],true,f.db),/cleanup remains incomplete/);
 status=200;
 for(rows of [[{date:'2026-11-06',open:0,high:0,low:0,close:0}],[{date:'2026-11-05',open:1,high:1,low:1,close:1}]]){
  assert.deepEqual(await persistBulkEodPrices(input,['US:EONR.WT'],true,f.db),['US:EONR.WT']);
 }
 rows={error:'unexpected response'};
 await assert.rejects(persistBulkEodPrices(input,['US:EONR.WT'],true,f.db),/cleanup remains incomplete/);
 assert.equal(f.rows.size,0);
});

test('bulk import downloads once, writes only requested symbols, and repairs partial latest-pointer publication',async t=>{
 const before={app:globalThis.__adminApp,token:process.env.EODHD_API_TOKEN,bucket:process.env.EODHD_BULK_EOD_BUCKET};
 const app=admin.initializeApp({projectId:'synthetic-eod'},'eod-bulk-import');globalThis.__adminApp=app;
 process.env.EODHD_API_TOKEN='synthetic';process.env.EODHD_BULK_EOD_BUCKET='synthetic';
 t.after(async()=>{globalThis.__adminApp=before.app;for(const [key,value] of Object.entries({EODHD_API_TOKEN:before.token,EODHD_BULK_EOD_BUCKET:before.bucket})){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
 }await app.delete();});
 const f=pubsubFirestore(),collection=f.db.collection.bind(f.db);
 f.db.collection=((name:string)=>({...collection(name),where:()=>({get:async()=>({docs:[],size:0})})})) as unknown as typeof f.db.collection;
 const tickers=Array.from({length:1001},(_,i)=>`T${i}`),date='2026-11-06';
 for(const ticker of tickers)f.rows.set(`eod_prices/US_${ticker}_2026-11-05`,{ticker,market:'US',requestedDate:'2026-11-05',tradingDate:'2026-11-05',open:10,high:10,low:10,close:10,isFinal:true});
 const files=new Map<string,string>(),storage=getStorage(app);let downloads=0;
 t.mock.method(storage,'bucket',()=>({file:(path:string)=>({exists:async()=>[files.has(path)],download:async()=>[Buffer.from(files.get(path)!)],save:async(value:string)=>{files.set(path,value);}})}) as ReturnType<typeof storage.bucket>);
 t.mock.method(globalThis,'fetch',async(value:URL)=>{
  assert.equal(new URL(value).pathname,'/api/eod-bulk-last-day/US');downloads++;
  return Response.json([...tickers,'UNREQUESTED'].map(code=>({code,date,exchange_short_name:'US',open:11,high:11,low:11,close:11,adjusted_close:11})));
 });
 const input={market:'US' as const,runDate:date};
 await withEodWorkScope(async()=>{
  assert.deepEqual(await persistBulkEodPrices(input,tickers.slice(0,1000).map(t=>`US:${t}`),false,f.db),[]);
  assert.deepEqual(await persistBulkEodPrices(input,['US:T1000'],false,f.db),[]);
 });
 assert.equal(downloads,1);assert.equal(f.rows.has(`eod_prices/US_UNREQUESTED_${date}`),false);
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('eod_prices/')&&k.endsWith(date)).length,1001);
 assert.ok(Math.abs(Number(f.rows.get(`eod_prices/US_T0_${date}`)?.dailyReturn)-0.1)<1e-10);
 assert.equal((f.rows.get('tickers/US_T0')?.latestEodPrice as {tradingDate:string}).tradingDate,date);
 // Simulate source commit succeeding before latest pointers fail. A retry must
 // repair latest state from the cached bar without another provider request.
 f.rows.delete('tickers/US_T0');f.reject((path)=>path==='tickers/US_T0');
 await assert.rejects(persistBulkEodPrices(input,['US:T0'],false,f.db),/transaction failed/);
 f.reject(()=>false);await persistBulkEodPrices(input,['US:T0'],false,f.db);
 assert.equal((f.rows.get('tickers/US_T0')?.latestEodPrice as {tradingDate:string}).tradingDate,date);assert.equal(downloads,1);
});
