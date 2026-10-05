import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("company search prioritizes exact tickers beyond capped name matches and protects editorial identities", async () => {
  const records = new Map<string, Record<string, unknown>>();
  let failed = false;
  const reads: string[] = [];
  const fixture = { db: { collection: () => ({
    where: (field: string, operator: string, value: string) => ({ limit: (limit: number) => ({ get: async () => ({ docs: [...records.entries()]
      .filter(([,data]) => operator === "==" ? data[field] === value : Array.isArray(data[field]) && (data[field] as string[]).includes(value))
      .slice(0,limit).map(([id,data]) => ({id,data:()=>data})) }) }) }),
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
  records.clear();
  for(let i=0;i<50;i++)records.set(`US:A${i}`,{symbol:`A${i}`,name:`Muncy Company ${i}`,symbolLower:`a${i}`,nameLower:`muncy company ${i}`,searchPrefixes:["mu"],symbolPrefixes:["a"],market:"US",active:true,predictionSupported:true});
  const micron={symbol:"MU",name:"Micron Technology, Inc.",symbolLower:"mu",nameLower:"micron technology, inc.",searchPrefixes:["m","mu","micron"],symbolPrefixes:["m","mu"],market:"US",active:true,predictionSupported:true};
  records.set("US:MU",micron);
  records.set("US:MUL",{...micron,symbol:"MUL",symbolLower:"mul",name:"Ticker prefix match",symbolPrefixes:["m","mu","mul"]});
  for(const q of ["MU","mu","$ＭＵ"])for(const scope of ["all","calls",""]){
    const items=(await (await request(q,scope)).json()).items;
    assert.equal(items[0].id,"US:MU");
    assert.equal(items[1].id,"US:MUL");
    assert.equal(items.filter((item:{id:string})=>item.id==="US:MU").length,1);
  }
  records.set("US:MU",{...micron,status:"WITHDRAWN"});
  assert.equal((await (await request("MU")).json()).items.some((item:{id:string})=>item.id==="US:MU"),false);
  records.set("US:MU",{...micron,active:false,predictionSupported:false});
  assert.equal((await (await request("MU","calls")).json()).items.some((item:{id:string})=>item.id==="US:MU"),false);
  records.clear(); failed = true;
  assert.equal((await request("Samsung")).status, 500);
});
