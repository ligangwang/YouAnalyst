import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {pricePlan,priceRows,type PriceOptions} from '../../src/lib/local-cache/price-directory';
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
