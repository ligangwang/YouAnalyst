import test from "node:test";
import assert from "node:assert/strict";
import type {Firestore} from "firebase-admin/firestore";
import {assessShares,calculateMarketCap,refreshCachedMarketCaps} from "../../src/lib/fundamentals/market-cap";
import type {CompanyFacts} from "../../src/lib/fundamentals/model";
import {createMaintenanceLog} from "../../src/lib/maintenance-log";
const row={val:1000,end:"2026-08-01",filed:"2026-08-05",form:"10-Q",accn:"0000000001-26-000001"};
const facts:CompanyFacts={cik:1,facts:{dei:{EntityCommonStockSharesOutstanding:{units:{shares:[row,{...row,end:"2025-01-01",val:999}]}}}}};
const now=new Date("2026-09-21T21:00:00Z");
const assessment=()=>assessShares(facts,"ABC",["ABC"],"10-K","2026-09-21");
const price={ticker:"ABC",market:"US",tradingDate:"2026-09-18",close:25};
test("uses latest instantaneous outstanding shares, not weighted-average EPS shares",()=>{
 assert.equal(assessment().basis?.shares,1000);
 assert.equal(assessment().basis?.date,"2026-08-01");
 assert.equal(calculateMarketCap(assessment(),price,"ABC",now).value,25000);
 const absent={cik:1,facts:{"us-gaap":{WeightedAverageNumberOfDilutedSharesOutstanding:{units:{shares:[row]}}}}};
 assert.equal(assessShares(absent,"ABC",["ABC"],"10-K").basis,null);
});
test("foreign listings, multiple tickers, ambiguous shares and later split events fail closed",()=>{
 assert.equal(assessShares(facts,"ABC",["ABC"],"20-F").basis,null);
 assert.equal(assessShares(facts,"ABC",["ABC","ABC.B"],"10-K").basis,null);
 const conflict=structuredClone(facts);conflict.facts!.dei.EntityCommonStockSharesOutstanding.units!.shares.push({...row,val:2000});
 assert.equal(assessShares(conflict,"ABC",["ABC"],"10-K").basis,null);
 const split=structuredClone(facts);split.facts!["us-gaap"]={StockSplitConversionRatio:{units:{pure:[{val:10,end:"2026-09-01"}]}}};
 assert.equal(assessShares(split,"ABC",["ABC"],"10-K","2026-09-21").basis,null);
});
test("missing, mismatched and future prices, stale shares, or shares newer than price do not yield values",()=>{
 for(const p of [undefined,{...price,ticker:"OTHER"},{...price,market:"CN_A"},{...price,close:NaN},{...price,tradingDate:"2026-12-01"}])assert.equal(calculateMarketCap(assessment(),p,"ABC",now).value,null);
 assert.equal(calculateMarketCap(assessment(),{...price,tradingDate:"2026-07-01"},"ABC",now).reason,"share_count_newer_than_price");
 assert.equal(calculateMarketCap({...assessment(),basis:{...assessment().basis!,date:"2025-01-01"}},price,"ABC",now).reason,"stale_share_count");
 assert.equal(calculateMarketCap(undefined,price,"ABC",now).value,null);
});
test("batch recalculates fresh SEC caches using newest stored EOD date without fetching providers, and isolates write failures",async(t)=>{
 t.mock.method(console,"info",()=>{});t.mock.method(console,"error",()=>{});
 t.mock.method(globalThis,"fetch",async()=>{throw Error("No provider calls allowed");});
 const writes:Record<string,unknown>={};const queries:unknown[][]=[];
 const share={...assessment(),basis:{...assessment().basis!,date:new Date().toISOString().slice(0,10)}};
 const docs=["ABC","FAIL","MISSING"].map(id=>({id,data:()=>({value:{shareAssessment:share},refreshAfter:Date.now()+86400000}),ref:{set:async(v:unknown)=>{if(id==="FAIL")throw Error("synthetic write failure");writes[id]=v;}}}));
 const db={collection:(name:string)=>{
 if(name==="company_fundamentals")return {orderBy:()=>({limit:()=>({get:async()=>({docs,size:3})})})};
 let ticker="";const query={orderBy:()=>query,where:(...args:unknown[])=>{queries.push(args);if(args[1]===">=")ticker=String(args[2]).split("_")[1];return query;},limit:(n:number)=>{assert.equal(n,1);return query;},get:async()=>({docs:ticker==="MISSING"?[]:[{data:()=>({...price,ticker,tradingDate:share.basis.date})}]})};return query;
 }} as unknown as Firestore;
 const result=await refreshCachedMarketCaps(db,createMaintenanceLog("test"),Date.now()+60000);
 assert.deepEqual(result,{processed:2,estimated:1,unavailable:1,failed:1,incomplete:false});
 assert.equal((writes.ABC as {marketCap:{value:number}}).marketCap.value,25000);
 assert.equal((writes.MISSING as {marketCap:{value:null}}).marketCap.value,null);
 assert(queries.some(q=>q[1]===">="&&q[2]==="US_ABC_"));
});
