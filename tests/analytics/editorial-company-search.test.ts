import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("exact tickers and ticker prefixes survive a full page of name matches", async () => {
  const company = (symbol: string, name: string, status = "PUBLISHED") => ({ id: `US:${symbol}`, data: () => ({ symbol, symbolLower: symbol.toLowerCase(), name, market: "US", active: true, predictionSupported: true, status }) });
  const names = Array.from({length: 50}, (_, index) => company(`A${index}`, `Systems ${index}`));
  const exact = company("TEM", "Tempus AI"), prefix = company("TEMX", "Ticker prefix company"), hidden = company("TEMH", "Hidden company", "WITHDRAWN");
  const reads: string[] = [];
  const fixture = { db: { collection: () => ({ select(...fields:string[]){ assert(fields.includes('searchTerms'));assert(!fields.includes('searchPrefixes'));return this; }, where: (field: string, op:string) => {
    const query={where:()=>query,limit:(limit:number)=>({get:async()=>{
      reads.push(field+':'+op);
      return {docs:(field==='symbolLower'?(op==='=='?[exact]:[exact,prefix,hidden]):names).slice(0,limit)};
    }})};return query;
  } }) } };
  const bundle = await build({ entryPoints: ["src/app/api/tickers/search/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "no-live-services", setup(builder) {
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: "export const getAdminFirestore = () => fixture.db;", loader: "js" }));
  } }] });
  const testModule = { exports: {} as { GET: (request: { nextUrl: URL }) => Promise<Response> } };
  new Function("fixture", "require", "module", bundle.outputFiles[0].text)(fixture, createRequire(import.meta.url), testModule);
  for (const scope of ["all", "calls", ""]) {
    const response = await testModule.exports.GET({nextUrl: new URL(`https://example.com/api/tickers/search?q=TEM&limit=8&scope=${scope}`)});
    assert.equal(response.status, 200);
    const {items} = await response.json();
    assert.deepEqual(items.slice(0, 2).map((item: {id:string}) => item.id), ["US:TEM", "US:TEMX"]);
    assert.equal(items.filter((item: {id:string}) => item.id === "US:TEM").length, 1);
    assert.ok(items.every((item: {id:string}) => item.id !== "US:TEMH"));
  }
  for (const scope of ["calls", ""]) {
    reads.length = 0;
    await testModule.exports.GET({nextUrl: new URL(`https://example.com/api/tickers/search?q=T&scope=${scope}`)});
    assert.equal(reads.filter(field => field === "symbolLower:>=").length, 1);
  }
});

test("research directory finds missing editorial identities without exposing hidden rows or enabling calls", async () => {
  const records = new Map<string, Record<string, unknown>>();
  let failed = false;
  const reads: string[] = [];
  const fixture = { db: { collection: () => ({ select(...fields:string[]){ assert(fields.includes('searchTerms'));assert(!fields.includes('searchPrefixes'));return this; },
    where: () => { const query={where:()=>query,limit:()=>({get:async()=>({docs:[]})})};return query; },
    doc: (id: string) => ({ get: async () => {
      reads.push(id);
      if (failed) throw new Error("Unavailable");
      return { exists: records.has(id), data: () => records.get(id) };
    } }),
  }) } };
  const bundle = await build({ entryPoints: ["src/app/api/tickers/search/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "no-live-services", setup(builder) {
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: "export const getAdminFirestore = () => fixture.db;", loader: "js" }));
  } }] });
  const testModule = { exports: {} as { GET: (request: { nextUrl: URL }) => Promise<Response> } };
  new Function("fixture", "require", "module", bundle.outputFiles[0].text)(fixture, createRequire(import.meta.url), testModule);
  const request = (q: string, scope = "all") => testModule.exports.GET({ nextUrl: new URL(`https://example.com/api/tickers/search?${new URLSearchParams({ q, scope })}`) });
  for (const q of ["SKHY", "SK hynix", "hynix", "海力士"]) {
    const result = await (await request(q)).json();
    assert.deepEqual(result.items.map((item: {id:string}) => item.id), ["US:SKHY"]);
    assert.equal(result.items[0].market, "US");
  }
  const samsung = await (await request("三星")).json();
  assert.deepEqual(samsung.items.map((item: {id:string}) => item.id), ["ORG:SAMSUNG-ELECTRONICS"]);
  assert.equal(samsung.items[0].market, "GLOBAL");
  for (const scope of ["calls", ""]) {
    reads.length = 0;
    assert.deepEqual((await (await request("SKHY", scope)).json()).items, []);
    assert.deepEqual(reads, []);
  }
  for (const data of [{ status: "WITHDRAWN", name: "SK hynix" }, { status: "DIRECTORY" }, {}]) {
    records.set("US:SKHY", data);
    assert.deepEqual((await (await request("SKHY")).json()).items, []);
  }
  records.clear(); failed = true;
  assert.equal((await request("Samsung")).status, 500);
});
