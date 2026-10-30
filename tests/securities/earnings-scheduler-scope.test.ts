import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldPath,Timestamp,type Firestore} from 'firebase-admin/firestore';
import type {EntityRows} from '../../src/lib/entity-snapshots/sqlite';
import {readEarningsScheduleCompanies} from '../../src/lib/earnings/scheduler-scope';

const supported={name:'Issuer',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}};
const doc=(id:string,data:Record<string,unknown>)=>({id,data:()=>data});
function fixture(pages:ReturnType<typeof doc>[][]){
  const filters:unknown[][]=[];let reads=0,cursor:unknown;
  const query={where:(...args:unknown[])=>{filters.push(args);return query;},orderBy:()=>query,select:()=>query,
    startAfter:(value:unknown)=>{assert.equal(value,pages[reads-1].at(-1));cursor=value;return query;},
    limit:(n:number)=>{assert.equal(n,250);return query;},
    get:async()=>{const docs=pages[reads++];return {docs,size:docs.length};},
    onSnapshot:()=>assert.fail('One-shot scheduling must not attach listeners'),
  };
  const db={collection:(name:string)=>{assert.equal(name,'companies');return query;}} as unknown as Firestore;
  return {db,filters,get reads(){return reads;},get cursor(){return cursor;}};
}
test('snapshot CN scope applies enrollment additions, blocks and removals before scheduling',async()=>{
  const rows:EntityRows=new Map([
    ['XSHG:600001',supported],['XSHG:600002',supported],['XSHG:600003',supported],['US:A',supported],
  ]);rows.watermark=new Timestamp(100,0);
  const f=fixture([[doc('XSHG:600001',{...supported,onboarding:{status:'BLOCKED'}}),
    doc('XSHG:600002',{isDeleted:true}),doc('XSHE:000001',supported)]]);
  const result=await readEarningsScheduleCompanies(f.db,async()=>rows);
  assert.deepEqual(result.map(n=>n.id),['XSHE:000001','XSHG:600003']);
  assert.equal(f.reads,1);
  assert.equal(f.filters[0][0],'updatedAt');assert.equal(f.filters[0][2],rows.watermark);
  assert((f.filters[1][0] as FieldPath).isEqual(FieldPath.documentId()));
  assert.deepEqual(f.filters.slice(1).map(f=>f.slice(1)),[['>=','XSHE:'],['<','XSHG;']]);
});
test('CN delta catch-up paginates without losing companies sharing a timestamp',async()=>{
  const rows:EntityRows=new Map();rows.watermark=new Timestamp(100,0);
  const first=Array.from({length:250},(_,i)=>doc(`XSHG:${600000+i}`,{...supported,updatedAt:rows.watermark}));
  const f=fixture([first,[doc('XSHG:600250',supported)]]);
  assert.equal((await readEarningsScheduleCompanies(f.db,async()=>rows)).length,251);
  assert.equal(f.reads,2);assert(f.cursor);
});
test('an absent snapshot falls back to supported CN reads; invalid snapshots fail closed',async()=>{
  const f=fixture([[doc('XSHE:000001',supported)]]);
  assert.equal((await readEarningsScheduleCompanies(f.db,async()=>undefined)).length,1);
  assert.deepEqual(f.filters[0],['onboarding.status','==','SUPPORTED']);
  assert.deepEqual(f.filters.slice(1).map(f=>f.slice(1)),[['>=','XSHE:'],['<','XSHG;']]);
  await assert.rejects(readEarningsScheduleCompanies(f.db,async()=>new Map()),/freshness boundary/);
  await assert.rejects(readEarningsScheduleCompanies(f.db,async()=>{throw Error('corrupt file');}),/corrupt file/);
  assert.equal(f.reads,1);
});
