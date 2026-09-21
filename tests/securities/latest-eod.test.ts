import test from "node:test";
import assert from "node:assert/strict";
import {shouldReplaceLatest,readLatestUsPrices,saveLatestEodPrice} from "../../src/lib/predictions/latest-eod";
import type {Firestore} from "firebase-admin/firestore";
const price={ticker:"MU",market:"US",tradingDate:"2026-09-18",close:100,currency:"USD",source:"test",loadedAt:"now"};
test("latest prices accept same-date corrections but never roll backward or mix markets",()=>{
 assert.equal(shouldReplaceLatest(price,{...price,tradingDate:"2026-09-17"}),false);
 assert.equal(shouldReplaceLatest(price,{...price,close:101}),true);
 assert.equal(shouldReplaceLatest(price,{...price,tradingDate:"2026-09-21"}),true);
 assert.equal(shouldReplaceLatest(price,{...price,market:"FX"}),false);
 assert.equal(shouldReplaceLatest(undefined,{...price,close:NaN}),false);
});
test("market-cap price reads use ticker snapshots, never price history",async()=>{
 const db={collection:(name:string)=>{assert.equal(name,"tickers");return {where:()=>({select:()=>({get:async()=>({docs:[{data:()=>({latestEodPrice:price})},{data:()=>({latestEodPrice:{...price,market:"FX",close:7}})}]})})})};}} as unknown as Firestore;
 assert.equal((await readLatestUsPrices(db,["MU"])).get("MU")?.close,100);
});
test("a conflicting writer's newer price survives a retried version-checked write",async t=>{
 t.mock.method(console,"warn",()=>{});
 let current={...price,market:"FX",ticker:"USD_CNY",tradingDate:"2026-09-17"};
 let writes=0;
 const ref={id:"FX_USD_CNY",get:async()=>({exists:true,updateTime:"version1",data:()=>({latestEodPrice:current})}),
 update:async(_v:unknown,precondition:unknown)=>{assert.deepEqual(precondition,{lastUpdateTime:"version1"});writes++;current={...current,tradingDate:"2026-09-21"};throw Object.assign(new Error("changed"),{code:9});}};
 const db={collection:()=>({doc:()=>ref})} as unknown as Firestore;
 await saveLatestEodPrice(db,{...current,tradingDate:"2026-09-18"});
 assert.equal(writes,1);
 assert.equal(current.tradingDate,"2026-09-21");
});
