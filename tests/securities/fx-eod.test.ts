import test from "node:test";
import assert from "node:assert/strict";
import type {Firestore} from "firebase-admin/firestore";
import {loadUsdCnyEod} from "../../src/lib/predictions/fx-eod";
test("FX stores the requested daily close and reuses it without a provider call",async t=>{
 const old=process.env.EODHD_API_TOKEN;process.env.EODHD_API_TOKEN="test-secret";
 t.after(()=>{if(old===undefined)delete process.env.EODHD_API_TOKEN;else process.env.EODHD_API_TOKEN=old;});
 const records=new Map<string,Record<string,unknown>>();
 const db={collection:(name:string)=>({doc:(id:string)=>({id:`${name}/${id}`,get:async()=>({data:()=>records.get(`${name}/${id}`)}),set:async(v:Record<string,unknown>)=>{records.set(`${name}/${id}`,v);}})}),runTransaction:async(fn:(tx: unknown)=>Promise<unknown>)=>fn({getAll:async(...refs:{id:string}[])=>refs.map(ref=>({exists:records.has(ref.id),data:()=>records.get(ref.id)})),set:(ref:{id:string},v:Record<string,unknown>)=>records.set(ref.id,v)})} as unknown as Firestore;
 let requests=0;
 t.mock.method(globalThis,"fetch",async()=>{requests++;return new Response(JSON.stringify([{date:"2026-09-18",close:6.6977}]));});
 assert.equal((await loadUsdCnyEod(db,"2026-09-18")).close,6.6977);
 await loadUsdCnyEod(db,"2026-09-18");
 assert.equal(requests,1);
 assert.equal(records.get("eod_prices/FX_USD_CNY_2026-09-18")?.baseCurrency,"USD");
 assert.ok(records.get("tickers/FX_USD_CNY")?.latestEodPrice);
 await assert.rejects(loadUsdCnyEod(db,"2026-09-17"),/unavailable/);
 assert.equal(records.has("eod_prices/FX_USD_CNY_2026-09-17"),false);
});
