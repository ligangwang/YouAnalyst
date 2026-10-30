import {withCompanyPageReads} from '../../src/lib/local-cache/company-page-scope';
import {loadPeerPrices} from '../../src/lib/peer-comparison/price-cache';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {pricePlan,priceRows,refreshPriceIds,type PriceOptions} from '../../src/lib/local-cache/price-directory';
import {pricePartition} from '../../src/lib/entity-snapshots/price-partition';
import type {EntityRows} from '../../src/lib/entity-snapshots/sqlite';
import type {ChangeBatch} from '../../src/lib/local-cache/entity-sync';
const stamp=(n:number)=>new Timestamp(n,0);
function fixture(){
 const loads:string[]=[],boundaries:number[]=[],callbacks=new Map<string,(batch:ChangeBatch)=>void>();
 const db={} as Firestore;
 const options:PriceOptions={years:async()=>[2024,2025,2026],file:async part=>{
  loads.push(part.object);const rows:EntityRows=new Map();
  for(let day=1;day<=20;day++)rows.set(`US_NVDA_${part.year}-01-${String(day).padStart(2,'0')}`,{close:day,updatedAt:stamp(1)});
  rows.watermark=stamp(2);return rows;
 },subscribe:part=>(since,next)=>{boundaries.push(since.seconds);callbacks.set(part.object,next);queueMicrotask(()=>next({readTime:stamp(3),changes:[]}));return()=>{};}};
 return {db,options,loads,boundaries,callbacks};
}
const query=(lower:string,upper:string,limit=12)=>pricePlan(undefined,[{method:'where',args:['__name__','>=',lower]},{method:'where',args:['__name__','<=',upper]},{method:'orderBy',args:['__name__','desc']},{method:'limit',args:[limit]}])!;
test('latest prices download only newest partition, share concurrent reads, and consume live corrections/deletes',async()=>{
 const f=fixture(),plan=query('US_NVDA_','US_NVDA_2026-12-31');
 const [a,b]=await Promise.all([priceRows(f.db,plan,f.options),priceRows(f.db,plan,f.options)]);
 assert.equal(a.size,20);assert.equal(b.size,20);assert.deepEqual(f.loads,['price-snapshots/US/NVDA/2026.sqlite']);assert.deepEqual(f.boundaries,[2]);
 f.callbacks.get(f.loads[0])!({readTime:stamp(4),changes:[{id:'US_NVDA_2026-01-20',data:{close:99,updatedAt:stamp(4)}},{id:'US_NVDA_2026-01-19',data:{isDeleted:true,updatedAt:stamp(4)}}]});
 const corrected=await priceRows(f.db,plan,f.options);assert.equal(corrected.get('US_NVDA_2026-01-20')?.close,99);assert.equal(corrected.has('US_NVDA_2026-01-19'),false);assert.equal(f.loads.length,1);
});
test('date bounds and year rollover load only needed years; another instance downloads its own needed partition',async()=>{
 const f=fixture();await priceRows(f.db,query('US_NVDA_','US_NVDA_2026-01-02'),f.options);
 assert.deepEqual(f.loads,['price-snapshots/US/NVDA/2026.sqlite','price-snapshots/US/NVDA/2025.sqlite']);
 const other=fixture();await priceRows(other.db,query('US_NVDA_2024-01-01','US_NVDA_2024-12-31'),other.options);
 assert.deepEqual(other.loads,['price-snapshots/US/NVDA/2024.sqlite']);
});
test('exact US, Chinese and FX IDs route correctly; broad scans never become full file downloads',()=>{
 assert.equal(pricePartition('CN_A_XSHE:000063_2026-01-01')?.object,'price-snapshots/CN_A/XSHE%3A000063/2026.sqlite');
 assert.equal(pricePartition('FX_USD_CNY_2026-01-01')?.object,'price-snapshots/FX/USD_CNY/2026.sqlite');
 assert.equal(pricePlan('US_NVDA_2025-01-01',[])?.firstYear,2025);
 assert.equal(pricePlan(undefined,[]),undefined);
 assert.equal(pricePlan(undefined,[{method:'where',args:['ticker','==','NVDA']}]),undefined);
 assert.equal(query('US_AMD_','US_NVDA_2026-01-01'),undefined);
});


test('observed website queries and getAll use only their requested partitions across instances',async()=>{
 process.env.PRICE_SNAPSHOT_READY='1';
 for(let instance=0;instance<2;instance++){
  const f=fixture(),db=observeFirestore(new Firestore({projectId:'partition-test-'+instance}),()=>{});
  enableCompanyDirectory(db,f.db,{price:f.options});
  const result=await db.collection('eod_prices').where('__name__','>=','US_NVDA_').where('__name__','<=','US_NVDA_2026-12-31').orderBy('__name__','desc').limit(12).get();
  assert.equal(result.size,12);assert.equal(result.docs[0].get('close'),20);
  const docs=await db.getAll(db.collection('eod_prices').doc('US_NVDA_2026-01-01'));
  assert.equal(docs[0].get('close'),1);assert.deepEqual(f.loads,['price-snapshots/US/NVDA/2026.sqlite']);
 }
});


test('local writes refresh only loaded price IDs without downloading other partitions',async()=>{
 const f=fixture(),readIds:string[]=[];
 Object.assign(f.db,{collection:()=>({doc:(id:string)=>({id})}),getAll:async(...refs:{id:string}[])=>refs.map(ref=>{readIds.push(ref.id);return {id:ref.id,exists:true,data:()=>({close:88,updatedAt:stamp(8)})};})});
 const plan=query('US_NVDA_','US_NVDA_2026-12-31');await priceRows(f.db,plan,f.options);
 await refreshPriceIds(f.db,['US_NVDA_2026-01-20','US_AMD_2025-01-20']);
 assert.deepEqual(readIds,['US_NVDA_2026-01-20']);assert.equal((await priceRows(f.db,plan,f.options)).get(readIds[0])?.close,88);assert.equal(f.loads.length,1);
});


test('peer page readers share file hydration and await catch-up, then apply corrections, deletes and new prices',async t=>{
 const previous=process.env.PRICE_SNAPSHOT_READY;process.env.PRICE_SNAPSHOT_READY='1';
 t.after(()=>{if(previous===undefined)delete process.env.PRICE_SNAPSHOT_READY;else process.env.PRICE_SNAPSHOT_READY=previous;});
 const f=fixture(),db=observeFirestore(new Firestore({projectId:'peer-file-test'}),()=>{});
 let release!:(batch:ChangeBatch)=>void;
 let subscribed!:()=>void;const ready=new Promise<void>(resolve=>{subscribed=resolve;});
 f.options.subscribe=()=> (since,next)=>{assert.equal(since.seconds,2);release=next;subscribed();return()=>{};};
 enableCompanyDirectory(db,f.db,{price:f.options});
 const read=(through='2026-01-20')=>withCompanyPageReads(()=>loadPeerPrices(db,'US:NVDA','US',through));
 let settled=false;const reads=Promise.all(Array.from({length:20},()=>read())).then(rows=>{settled=true;return rows;});
 await ready;assert.equal(settled,false,'stale file data is not served before catch-up');
 release({readTime:stamp(4),changes:[{id:'US_NVDA_2026-01-20',data:{close:99,updatedAt:stamp(4)}}]});
 const result=await reads;assert.equal(result[0].length,12);assert.equal(result[0][0].close,99);assert.equal(f.loads.length,1);
 result[0][0].close=-1;assert.equal((await read())[0].close,99,'callers cannot mutate cached rows');
 release({readTime:stamp(5),changes:[{id:'US_NVDA_2026-01-20',data:{isDeleted:true,updatedAt:stamp(5)}},{id:'US_NVDA_2026-01-21',data:{close:21,updatedAt:stamp(5)}}]});
 assert.deepEqual((await read()).map(row=>row.close),[19,18,17,16,15,14,13,12,11,10,9,8]);
 assert.equal((await read('2026-01-21'))[0].close,21);assert.equal(f.loads.length,1,'date changes reuse the same partition');
});

function liveRows(records:Map<string,Record<string,unknown>>){
 const requests:{lower:string;upper:string;limit?:number}[]=[];
 function query(lower='',upper='\uffff',limit?:number,cursor?:string):unknown{return {
  where:(_field:unknown,op:string,value:string)=>query(op==='>='?value:lower,op==='<='?value:upper,limit,cursor),
  orderBy:()=>query(lower,upper,limit,cursor),limit:(n:number)=>query(lower,upper,n,cursor),startAfter:(id:string)=>query(lower,upper,limit,id),
  get:async()=>{requests.push({lower,upper,limit});const selected=[...records].filter(([id])=>id>=lower&&id<=upper&&(!cursor||id<cursor)).sort(([a],[b])=>b.localeCompare(a)).slice(0,limit);
   return {size:selected.length,readTime:stamp(3),docs:selected.map(([id,data])=>({id,data:()=>data}))};},
 };}
 return {db:{collection:(name:string)=>{assert.equal(name,'eod_prices');return query();}} as unknown as Firestore,requests};
}

test('missing current-year files use a ticker/year query and catch up from its read time',async()=>{
 const live=liveRows(new Map([['US_NVDA_2026-01-01',{close:10,updatedAt:stamp(1)}]]));
 let next!:(batch:ChangeBatch)=>void;
 const options:PriceOptions={years:async()=>[],file:async()=>undefined,subscribe:()=>(since,emit)=>{assert.equal(since.seconds,3);next=emit;queueMicrotask(()=>emit({readTime:stamp(4),changes:[{id:'US_NVDA_2026-01-01',data:{close:20,updatedAt:stamp(4)}}]}));return()=>{};}};
 const plan=query('US_NVDA_','US_NVDA_2026-12-31',1);
 assert.equal((await priceRows(live.db,plan,options)).get('US_NVDA_2026-01-01')?.close,20);
 assert.deepEqual(live.requests,[{lower:'US_NVDA_2026-',upper:'US_NVDA_2026-\uf8ff',limit:undefined}]);
 next({readTime:stamp(5),changes:[{id:'US_NVDA_2026-01-01',data:{close:30,updatedAt:stamp(5)}}]});
 assert.equal((await priceRows(live.db,plan,options)).get('US_NVDA_2026-01-01')?.close,30);assert.equal(live.requests.length,1);
});

test('a missing historical year is queried before older files, including tombstone pagination',async()=>{
 const records=new Map<string,Record<string,unknown>>([
  ['US_NVDA_2025-12-31',{isDeleted:true}],['US_NVDA_2025-12-30',{close:30}],['US_NVDA_2025-12-29',{close:29}],
  ['US_OTHER_2025-12-31',{close:999}],
 ]),live=liveRows(records),loads:number[]=[];
 const options:PriceOptions={years:async()=>[2024,2026],file:async part=>{loads.push(part.year);const rows:EntityRows=new Map([[`US_NVDA_${part.year}-01-01`,{close:part.year,updatedAt:stamp(1)}]]);rows.watermark=stamp(2);return rows;},subscribe:()=> (_since,next)=>{queueMicrotask(()=>next({readTime:stamp(3),changes:[]}));return()=>{};}};
 const result=await priceRows(live.db,query('US_NVDA_','US_NVDA_2026-01-01',3),options);
 assert.deepEqual([...result.values()].map(row=>row.close),[2026,30,29]);assert.deepEqual(loads,[2026]);
 assert.deepEqual(live.requests.map(r=>r.limit),[2,1]);
 assert.ok(live.requests.every(r=>r.lower==='US_NVDA_2025-01-01'&&r.upper==='US_NVDA_2025-12-31'));
 records.set('US_NVDA_2025-12-30',{close:300});
 assert.equal((await priceRows(live.db,query('US_NVDA_','US_NVDA_2026-01-01',3),options)).get('US_NVDA_2025-12-30')?.close,300,'unpublished ranges do not cache stale corrections');
});

test('history older than every available file is fetched in a bounded range',async()=>{
 const live=liveRows(new Map([['US_NVDA_2023-12-29',{close:9}]]));
 const options:PriceOptions={years:async()=>[],file:async()=>{const rows:EntityRows=new Map();rows.watermark=stamp(2);return rows;},subscribe:()=> (_since,next)=>{queueMicrotask(()=>next({readTime:stamp(3),changes:[]}));return()=>{};}};
 const rows=await priceRows(live.db,query('US_NVDA_','US_NVDA_2026-01-01',12),options);
 assert.equal(rows.get('US_NVDA_2023-12-29')?.close,9);
 assert.deepEqual(live.requests,[{lower:'US_NVDA_',upper:'US_NVDA_2025-12-31',limit:12}]);
});

test('a delayed local refresh cannot overwrite a newer listener correction',async()=>{
 const f=fixture();let resolve!:(docs:unknown[])=>void;
 Object.assign(f.db,{collection:()=>({doc:(id:string)=>({id})}),getAll:()=>new Promise(r=>{resolve=r;})});
 const plan=query('US_NVDA_','US_NVDA_2026-12-31');await priceRows(f.db,plan,f.options);
 const refresh=refreshPriceIds(f.db,['US_NVDA_2026-01-20']);
 f.callbacks.get(f.loads[0])!({readTime:stamp(9),changes:[{id:'US_NVDA_2026-01-20',data:{close:90,updatedAt:stamp(9)}}]});
 resolve([{id:'US_NVDA_2026-01-20',exists:true,data:()=>({close:80,updatedAt:stamp(8)})}]);await refresh;
 assert.equal((await priceRows(f.db,plan,f.options)).get('US_NVDA_2026-01-20')?.close,90);
});


test('partition eviction stays bounded and revisits reload files instead of full price listeners',async()=>{
 const db={} as Firestore,loads:string[]=[],closed:string[]=[];
 const options:PriceOptions={years:async()=>[2026],file:async part=>{loads.push(part.object);const rows:EntityRows=new Map([[part.prefix+'01-01',{close:1,updatedAt:stamp(1)}]]);rows.watermark=stamp(2);return rows;},subscribe:part=>(_since,next)=>{queueMicrotask(()=>next({readTime:stamp(3),changes:[]}));return()=>{closed.push(part.object);};}};
 for(let n=0;n<129;n++)await priceRows(db,query(`US_P${n}_`,`US_P${n}_2026-12-31`,1),options);
 assert.deepEqual(closed,['price-snapshots/US/P0/2026.sqlite']);
 await priceRows(db,query('US_P0_','US_P0_2026-12-31',1),options);
 assert.equal(loads.filter(name=>name==='price-snapshots/US/P0/2026.sqlite').length,2);
 assert.equal(closed.length,2);
});

test('unreadable files fail closed and can be retried without caching partial data',async()=>{
 const f=fixture(),file=f.options.file!;let fail=true;
 f.options.file=async part=>{if(fail)throw Error('corrupt file');return file(part);};
 const plan=query('US_NVDA_','US_NVDA_2026-12-31');
 await assert.rejects(priceRows(f.db,plan,f.options),/corrupt file/);
 fail=false;assert.equal((await priceRows(f.db,plan,f.options)).size,20);
});

test('a committed physical deletion cannot be resurrected by an older listener update',async()=>{
 const f=fixture();Object.assign(f.db,{collection:()=>({doc:(id:string)=>({id})}),getAll:async()=>[{id:'US_NVDA_2026-01-20',exists:false,readTime:stamp(9)}]});
 const plan=query('US_NVDA_','US_NVDA_2026-12-31');await priceRows(f.db,plan,f.options);
 await refreshPriceIds(f.db,['US_NVDA_2026-01-20']);
 f.callbacks.get(f.loads[0])!({readTime:stamp(10),changes:[{id:'US_NVDA_2026-01-20',data:{close:80,updatedAt:stamp(8)}}]});
 assert.equal((await priceRows(f.db,plan,f.options)).has('US_NVDA_2026-01-20'),false);
});
