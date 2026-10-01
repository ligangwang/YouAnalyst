import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("research directory finds missing editorial identities without exposing hidden rows or enabling calls", async () => {
  const records = new Map<string, Record<string, unknown>>();
  let failed = false;
  const reads: string[] = [];
  const fixture = { db: { collection: () => ({
    where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
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
