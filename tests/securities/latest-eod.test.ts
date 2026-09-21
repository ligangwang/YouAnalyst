import test from "node:test";
import assert from "node:assert/strict";
import {shouldReplaceLatest,readLatestUsPrices} from "../../src/lib/predictions/latest-eod";
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
