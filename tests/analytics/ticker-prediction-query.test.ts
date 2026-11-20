import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("ticker predictions reuse the first-page summary query and keep cursor and failure behavior", async () => {
  const days = Array.from({ length: 7 }, (_, i) => `2026-11-0${7-i}T00:00:00.000Z`);
  const rows = days.map((createdAt, i) => {
    const data: Record<string, unknown> = { createdAt, status: "OPEN", visibility: "PUBLIC", userId: `author-${i}`, direction: "UP" };
    return { id: String(i), data: () => data, get: (key: string) => data[key] };
  });
  const reads: Array<[number, string | undefined]> = [];
  let failSummary = false;
  const db = {
    collection(name: string) {
      if (name === "users") return { doc: () => ({ get: async () => ({ data: () => undefined }) }) };
      assert.equal(name, "predictions");
      let limit = 0;
      let cursor: string | undefined;
      const query = {
        where: () => query,
        orderBy: () => query,
        limit: (n: number) => { limit = n; return query; },
        startAfter: (value: string) => { cursor = value; return query; },
        get: async () => {
          reads.push([limit, cursor]);
          if (limit === 300 && failSummary) throw new Error("Summary unavailable");
          return { docs: rows.slice(cursor ? days.indexOf(cursor) + 1 : 0).slice(0, limit) };
        },
      };
      return query;
    },
  };
  const bundle = await build({
    entryPoints: ["src/app/api/ticker/[symbol]/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "mock-firebase", setup(builder) {
      builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: "export const getAdminFirestore = () => db;", loader: "js" }));
      builder.onLoad({ filter: /[\\/]firebase[\\/]auth\.ts$/ }, () => ({ contents: "export const getDecodedUserFromRequest = async () => null;", loader: "js" }));
    } }],
  });
  const testModule = { exports: {} as { GET: (req: { nextUrl: URL }, context: { params: Promise<{ symbol: string }> }) => Promise<Response> } };
  new Function("db", "require", "module", bundle.outputFiles[0].text)(db, createRequire(import.meta.url), testModule);
  async function request(query: string) {
    reads.length = 0;
    const response = await testModule.exports.GET({ nextUrl: new URL("https://example.com/api/ticker/AMD?limit=3" + query) }, { params: Promise.resolve({ symbol: "AMD" }) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const first = await request("&summary=1");
  assert.deepEqual(reads, [[300, undefined]]);
  assert.deepEqual(first.items.map((row: { id: string }) => row.id), ["0", "1", "2"]);
  assert.equal(first.nextCursor, days[2]);
  assert.equal(first.summary.analysts, 7);

  const later = await request("&summary=1&cursorCreatedAt=" + days[2]);
  assert.deepEqual(reads, [[300, undefined], [4, days[2]]]);
  assert.deepEqual(later.items.map((row: { id: string }) => row.id), ["3", "4", "5"]);
  assert.equal(later.nextCursor, days[5]);
  assert.deepEqual(later.summary, first.summary);

  assert.equal((await request("")).summary, undefined);
  assert.deepEqual(reads, [[4, undefined]]);

  failSummary = true;
  const fallback = await request("&summary=1");
  assert.equal(fallback.summary, undefined);
  assert.deepEqual(fallback.items, first.items);
  assert.deepEqual(reads, [[300, undefined], [4, undefined]]);
});
