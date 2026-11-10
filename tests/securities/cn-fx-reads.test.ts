import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {createFxReader} from '../../src/lib/fundamentals/cn-prices';
function fixture(values:Record<string,Record<string,unknown>>){
 const reads:string[][]=[];
 const db={collection:()=>({doc:(id:string)=>({id})}),getAll:async (...refs:{id:string}[])=>{
  reads.push(refs.map(r=>r.id));return refs.map(r=>({id:r.id,data:()=>values[r.id]}));
 }} as unknown as Firestore;
 return {read:createFxReader(db),reads};
}
const rate=(date:string,close:number)=>({market:'FX',ticker:'USD_CNY',tradingDate:date,close});
test('exact-date FX close needs one read and concurrent consumers reuse it',async()=>{
 const f=fixture({'FX_USD_CNY_2026-11-09':rate('2026-11-09',6.67)});
 const [a,b]=await Promise.all([f.read('2026-11-09'),f.read('2026-11-09')]);
 assert.deepEqual(a,b);assert.equal(a?.rate,6.67);assert.deepEqual(f.reads,[['FX_USD_CNY_2026-11-09']]);
});
test('missing or invalid exact rate retains the bounded seven-day fallback',async()=>{
 for(const invalid of [undefined,rate('2026-11-09',0),rate('2026-11-10',6.7),{...rate('2026-11-09',6.7),ticker:'OTHER'}]){
  const f=fixture({'FX_USD_CNY_2026-11-06':rate('2026-11-06',6.6),...(invalid?{'FX_USD_CNY_2026-11-09':invalid}:{})});
  assert.equal((await f.read('2026-11-09'))?.date,'2026-11-06');
  assert.equal(f.reads.flat().length,8);assert.equal(new Set(f.reads.flat()).size,8);
 }
 const empty=fixture({});assert.equal(await empty.read('2026-11-09'),null);
});
