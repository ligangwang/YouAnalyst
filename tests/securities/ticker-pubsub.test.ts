import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { parseTickerSyncRequest, processTickerSync, queueTickerSync, type TickerSyncRequest } from "../../src/lib/tickers/pubsub";
import { prepareTickerCatalogSync } from "../../src/lib/tickers/sync-tickers";

type Data = Record<string, unknown>;
function fixture() {
  const rows = new Map<string, Data>();
  const writes: string[] = [];
  let failPage = -1;
  const ref = (path: string) => ({ path, firestore: db,
    get: async () => ({ data: () => rows.get(path), get: (key: string) => rows.get(path)?.[key] }),
    set: async (data: Data, options?: { merge: boolean }) => { rows.set(path, options?.merge ? { ...rows.get(path), ...data } : data); },
  });
  type Ref = ReturnType<typeof ref>;
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      let fail = false;
      const result = await fn({ get: (r: Ref) => r.get(), getAll: (...args: Ref[]) => Promise.all(args.filter(r => r.path).map(r => r.get())),
        create: (r: Ref, data: Data) => pending.push(() => { assert.ok(!rows.has(r.path)); rows.set(r.path, data); }),
        set: (r: Ref, data: Data, options?: { merge: boolean }) => pending.push(() => { writes.push(r.path); rows.set(r.path, options?.merge ? { ...rows.get(r.path), ...data } : data); }),
        update: (r: Ref, data: Data) => {
          if (data.nextPage === failPage) fail = true;
          pending.push(() => rows.set(r.path, { ...rows.get(r.path), ...data }));
        },
      });
      if (fail) throw Error("commit failed");
      pending.forEach(write => write()); return result;
    },
  } as unknown as Firestore;
  const log = { runId: "delivery-1", emit: () => {} } as unknown as MaintenanceLog;
  const requests: TickerSyncRequest[] = [];
  const publish = async (r: TickerSyncRequest) => { requests.push(r); };
  return { rows, writes, db, log, requests, publish, failPage: (page: number) => { failPage = page; } };
}
const input = { dryRun: false, country: "United States", currency: "USD", limit: undefined, types: undefined };
const stock = (symbol: string, overrides = {}) => ({ symbol, name: symbol, country: "United States", currency: "USD",
  type: "Common Stock", exchange: "NYSE", mic_code: "XNYS", ...overrides });

test("queued sync rejects previews and malformed requests", async () => {
  const f = fixture(); await queueTickerSync(input, "admin", f.db, f.publish);
  for (const patch of [{ batchId: "../bad" }, { version: 2 }, { requestedAt: "bad" }, { input: { dryRun: true } }, { input: { dryRun: false, limit: -1 } }]) {
    assert.throws(() => parseTickerSyncRequest({ ...f.requests[0], ...patch }));
  }
});

test("ambiguous publication retries the original request and prevents overlapping options", async () => {
  const f = fixture(); let original: TickerSyncRequest | undefined;
  await assert.rejects(queueTickerSync(input, "admin", f.db, async r => { original = r; throw Error("publish timeout"); }, 1000), /publish timeout/);
  await assert.rejects(queueTickerSync(input, "admin", f.db, f.publish, 1001), { code: "ALREADY_RUNNING" });
  await assert.rejects(queueTickerSync({ ...input, limit: 10 }, "admin", f.db, f.publish, 32000), { code: "ALREADY_RUNNING" });
  await queueTickerSync(input, "admin", f.db, f.publish, 32000);
  assert.deepEqual(f.requests[0], original);
  assert.equal(f.rows.size, 2); // Existing collection: coordination + one ledger.
});

test("retry resumes atomic pages from the saved snapshot and skips a completed delivery", async t => {
  const f = fixture(); let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches++; return Response.json({ data: Array.from({ length: 205 }, (_, i) => stock(`T${i}`)) }); });
  await queueTickerSync(input, "admin", f.db, f.publish);
  f.failPage(2);
  await assert.rejects(processTickerSync(f.requests[0], f.db, f.log), /commit failed/);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith("tickers/")).length, 100);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith("companies/")).length, 100);
  f.failPage(-1);
  await assert.rejects(processTickerSync(f.requests[0], f.db, f.log, { deadline: Date.now() }), /incomplete/);
  assert.equal(fetches, 1);
  const result = await processTickerSync(f.requests[0], f.db, f.log);
  assert.equal(result.written, 205); assert.equal(result.batchesCommitted, 3); assert.equal(fetches, 1);
  const duplicate = await processTickerSync(f.requests[0], f.db, f.log);
  assert.ok("duplicate" in duplicate && duplicate.duplicate);
  assert.equal(f.writes.filter(p => p === "tickers/T0_XNYS").length, 1);
  assert.equal(f.rows.get("directory_syncs/TICKER_CATALOG")?.activeRequest, null);
  await queueTickerSync({ ...input, limit: 5 }, "admin", f.db, f.publish);
  assert.notEqual(f.requests[0].batchId, f.requests[1].batchId);
});

test("preferred listing and current reviewed translations survive a cross-page import", async t => {
  const f = fixture();
  const data = [stock("NVDA"), ...Array.from({ length: 100 }, (_, i) => stock(`T${i}`)), stock("NVDA", { exchange: "NASDAQ", mic_code: "XNAS" })];
  t.mock.method(globalThis, "fetch", async () => Response.json({ data }));
  f.rows.set("companies/US:NVDA", { country: "US", names: { "zh-CN": "英伟达" }, aliases: ["辉达"], research: "keep" });
  await queueTickerSync(input, "admin", f.db, f.publish);
  await processTickerSync(f.requests[0], f.db, f.log);
  const company = f.rows.get("companies/US:NVDA")!;
  assert.equal(company.exchange, "NASDAQ"); assert.equal(company.research, "keep");
  assert.equal(company.country, "US"); assert.deepEqual(company.names, { "zh-CN": "英伟达" });
  assert.ok((company.searchPrefixes as string[]).includes("辉达"));
  assert.equal(f.writes.filter(p => p === "companies/US:NVDA").length, 1);
});

test("expired preparation budget leaves the catalog untouched and can retry", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [stock("NVDA")] }));
  await queueTickerSync(input, "admin", f.db, f.publish);
  await assert.rejects(processTickerSync(f.requests[0], f.db, f.log, { deadline: Date.now() }), /needs retry/);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith("tickers/")).length, 0);
  await processTickerSync(f.requests[0], f.db, f.log, { prepare: prepareTickerCatalogSync });
});

test("lease contention leaves the request queued without fetching", async () => {
  const f = fixture(); await queueTickerSync(input, "admin", f.db, f.publish);
  Object.assign(f.rows.get("directory_syncs/TICKER_CATALOG")!, { leaseExpiresAtMs: Date.now() + 60000 });
  await assert.rejects(processTickerSync(f.requests[0], f.db, f.log, { prepare: async () => { throw Error("must not fetch"); } }), { code: "ALREADY_RUNNING" });
});
