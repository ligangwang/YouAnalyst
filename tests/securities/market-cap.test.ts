import test from "node:test";
import assert from "node:assert/strict";
import type {Firestore} from "firebase-admin/firestore";
import {assessShares,calculateMarketCap,refreshCachedMarketCaps} from "../../src/lib/fundamentals/market-cap";
import type {CompanyFacts} from "../../src/lib/fundamentals/model";
import {createMaintenanceLog} from "../../src/lib/maintenance-log";
import {verifiedForeignListings,reviewedForeignShareCounts,foreignOutstandingTags} from "../../src/lib/fundamentals/foreign-listings";
import {needsShareMetadataUpgrade} from "../../src/lib/fundamentals/service";
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

test("verified ADS ratios divide ordinary share counts, including TAL's three ADSs per share",()=>{
 for (const [ticker,listing] of Object.entries(verifiedForeignListings)) {
  const a={basis:{shares:3000,date:"2026-09-01",filed:"2026-09-02",tag:"reviewed",sourceUrl:listing.sourceUrl,listing},reason:null};
  const cap=calculateMarketCap(a,{...price,ticker,close:10},ticker,new Date("2026-09-25T00:00:00Z"));
  assert.equal(cap.value,10*3000/listing.ordinarySharesPerUnit,ticker);
 }
});

test("foreign facts use audited outstanding concepts, permit known secondary symbols and reject wrong identities",()=>{
 const listing=verifiedForeignListings.BABA;
 const f:CompanyFacts={cik:listing.cik,facts:{dei:{EntityCommonStockSharesOutstanding:{units:{shares:[{...row,end:"2026-09-01",filed:"2026-09-05",form:"20-F",val:100}]}}},"us-gaap":{CommonStockSharesOutstanding:{units:{shares:[{...row,end:"2026-09-01",filed:"2026-09-05",form:"20-F"}]}}}}};
 const a=assessShares(f,"BABA",["BABA","BABAF"],"20-F","2026-09-25");
 assert.equal(a.basis?.shares,1000);
 assert.equal(a.basis?.listing?.ordinarySharesPerUnit,8);
 assert.equal(assessShares({...f,cik:1},"BABA",["BABA"],"20-F").basis,null);
 assert.equal(assessShares(f,"BABA",["BABAF"],"20-F").basis,null);
 assert.equal(assessShares(f,"BABA",["BABA"],"40-F").basis,null);
 delete f.facts!["us-gaap"];
 assert.equal(assessShares(f,"BABA",["BABA"],"20-F","2026-08-01").reason,"missing_outstanding_shares");
});

test("reviewed disclosures keep dates, exclude treasury, expire, and yield to newer SEC outstanding facts",()=>{
 const f:CompanyFacts={cik:verifiedForeignListings.NBIS.cik,facts:{}};
 const a=assessShares(f,"NBIS",["NBIS"],"20-F","2026-09-25");
 assert.equal(a.basis?.shares,271855218);
 assert.equal(a.basis?.date,"2026-06-30");
 assert.equal(calculateMarketCap(a,{...price,ticker:"NBIS"},"NBIS",new Date("2027-01-01")).reason,"stale_share_count");
 assert.equal(assessShares(f,"NBIS",["NBIS"],"20-F","2026-08-01").basis,null);
 f.facts={"us-gaap":{CommonStockSharesOutstanding:{units:{shares:[{...row,form:"6-K"}]}}}};
 assert.equal(assessShares(f,"NBIS",["NBIS"],"20-F","2026-09-25").basis?.shares,1000);
 for (const [ticker,basis] of Object.entries(reviewedForeignShareCounts)) {
  assert(verifiedForeignListings[ticker]);assert(Number.isSafeInteger(basis.shares));
  assert(basis.sourceUrl.startsWith("https://"));assert(basis.filed>=basis.date);
 }
 assert(!foreignOutstandingTags.BIDU); // Class facts must not be mistaken for company totals.
});

test("foreign share metadata refreshes once after deployment, without bypassing retry backoff",()=>{
 const stored={value:{report:{form:"20-F"},shareAssessment:{basis:null,reason:"foreign_listing_requires_verified_share_ratio"}},outcome:"ready"};
 assert(needsShareMetadataUpgrade(stored));
 assert(!needsShareMetadataUpgrade({...stored,outcome:"retry"}));
 assert(!needsShareMetadataUpgrade({...stored,value:{...stored.value,shareAssessment:{...stored.value.shareAssessment,version:2}}}));
});

test("cached foreign ratios cannot transfer to a different symbol or bypass ratio verification",()=>{
 const basis={shares:8000,date:"2026-08-01",filed:"2026-08-05",sourceUrl:"https://www.sec.gov/",tag:"reviewed",listing:verifiedForeignListings.BABA};
 assert.equal(calculateMarketCap({basis,reason:null},price,"ABC",now).reason,"foreign_listing_requires_verified_share_ratio");
 assert.equal(calculateMarketCap({basis:{...basis,listing:{...basis.listing,ordinarySharesPerUnit:1}},reason:null},{...price,ticker:"BABA"},"BABA",now).reason,"foreign_listing_requires_verified_share_ratio");
});
test("batch recalculates fresh SEC caches using newest stored EOD date without fetching providers, and isolates write failures",async(t)=>{
 t.mock.method(console,"info",()=>{});t.mock.method(console,"error",()=>{});
 t.mock.method(globalThis,"fetch",async()=>{throw Error("No provider calls allowed");});
 const writes:Record<string,unknown>={};const queries:unknown[][]=[];
 const share={...assessment(),basis:{...assessment().basis!,date:new Date().toISOString().slice(0,10)}};
 const docs=["ABC","FAIL","MISSING"].map(id=>({id,data:()=>({value:{shareAssessment:share},refreshAfter:Date.now()+86400000}),ref:{set:async(v:unknown)=>{if(id==="FAIL")throw Error("synthetic write failure");writes[id]=v;}}}));
 const db={collection:(name:string)=>{
 if(name==="company_fundamentals")return {orderBy:()=>({limit:()=>({get:async()=>({docs,size:3})})})};
 assert.equal(name,"tickers");const query={where:(...args:unknown[])=>{queries.push(args);return query;},select:()=>query,get:async()=>({docs:["ABC","FAIL"].map(ticker=>({data:()=>({latestEodPrice:{...price,ticker,tradingDate:share.basis.date}})}))})};return query;
 }} as unknown as Firestore;
 const result=await refreshCachedMarketCaps(db,createMaintenanceLog("test"),Date.now()+60000);
 assert.deepEqual(result,{processed:2,estimated:1,unavailable:1,failed:1,incomplete:false});
 assert.equal((writes.ABC as {marketCap:{value:number}}).marketCap.value,25000);
 assert.equal((writes.MISSING as {marketCap:{value:null}}).marketCap.value,null);
 assert(queries.some(q=>q[0]==="symbol"&&q[1]==="in"));
});
