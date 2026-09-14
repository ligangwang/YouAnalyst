import assert from "node:assert/strict";
import { test } from "node:test";
import { companyListingFields, syncCompanyListings, type TickerCatalogDocument, runTickerCatalogSync } from "../../src/lib/tickers/sync-tickers";

test("ticker sync preserves reviewed company country while updating trading-market metadata", () => {
  const patch = companyListingFields({ symbol: "ASML", name: "ASML", country: "United States", exchange: "NASDAQ" });
  assert.equal(Object.hasOwn(patch, "country"), false);
  assert.equal({ country: "NL", ...patch }.country, "NL");
  assert.equal(patch.listingCountry, "United States");
  assert.equal(patch.exchange, "NASDAQ");
});

test("default ticker sync includes US depositary receipts and preserves market restrictions", async (t) => {
  const listing = (symbol: string, type: string, overrides = {}) => ({
    symbol, type, name: symbol, country: "United States", currency: "USD",
    exchange: "NYSE", mic_code: "XNYS", ...overrides,
  });
  const data = [
    listing("TSM", "American Depositary Receipt"),
    listing("DR", "Depositary Receipt"),
    listing("MRVL", "Common Stock"),
    listing("SPY", "ETF"),
    listing("2330", "Common Stock", { country: "Taiwan", currency: "TWD" }),
    listing("FOREIGN", "Depositary Receipt", { country: "Germany" }),
    listing("NONUSD", "American Depositary Receipt", { currency: "EUR" }),
    listing("PREF", "Preferred Stock"),
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json({ data }));

  const result = await runTickerCatalogSync();
  assert.equal(result.dryRun, true);
  assert.equal(result.written, 0);
  assert.equal(result.filteredCount, 4);
  assert.deepEqual(result.sample.map((item) => item.symbol), ["TSM", "DR", "MRVL", "SPY"]);
  assert.equal(result.sample[0].id, "TSM_XNYS");

  const restricted = await runTickerCatalogSync({ types: ["Common Stock", "ETF"] });
  assert.deepEqual(restricted.sample.map((item) => item.symbol), ["MRVL", "SPY"]);
});


test("company sync rebuilds search from current translations without replacing reviewed fields",async()=>{
 const ticker={symbol:"NVDA",name:"NVIDIA Corporation",country:"United States"};
 const old={names:{en:"NVIDIA","zh-CN":"英伟达"},aliases:["辉达"]};
 let written:Record<string,unknown>|undefined;
 const db={collection:()=>({doc:(id:string)=>({id})}),runTransaction:async(fn:(tx:unknown)=>unknown)=>fn({
  getAll:async()=>[{data:()=>old}],set:(_ref:unknown,patch:Record<string,unknown>,options:unknown)=>{assert.deepEqual(options,{merge:true});written=patch;}
 })} as unknown as import("firebase-admin/firestore").Firestore;
 await syncCompanyListings(db,[ticker as TickerCatalogDocument]);
 assert(written);
 const prefixes=written.searchPrefixes as string[];
 for(const query of ["英伟达","辉达","nvidia","nvda"])assert(prefixes.includes(query));
 assert.equal(Object.hasOwn(written,"names"),false);assert.equal(Object.hasOwn(written,"aliases"),false);
 assert.equal(written.name,"NVIDIA Corporation");
});
