import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { processFundamentalsBatch, publishPendingFundamentals } from "../../src/lib/fundamentals/pubsub-batch";
import { fundamentalsVersion, parseFundamentalsRequest, type FundamentalsRequest, type FundamentalsUpdate } from "../../src/lib/fundamentals/pubsub";

type Data = Record<string, unknown>;
function fixture(initial: Record<string, Data> = {}) {
  const rows = new Map<string, Data>(Object.entries(initial));
  const snap = (id: string) => ({ id, data: () => rows.has(id) ? structuredClone(rows.get(id)) : undefined,
    get: (key: string) => rows.get(id)?.[key] });
  const ref = (id: string) => ({ id, firestore: db, get: async () => snap(id),
    set: async (data: Data) => { rows.set(id, { ...rows.get(id), ...data }); },
    create: async (data: Data) => { assert.ok(!rows.has(id)); rows.set(id, data); } });
  const db = { collection: () => ({ doc: ref, where: () => {
    let after = "", limit = 100;
    const q = { orderBy: () => q, startAfter: (v: string) => { after = v; return q; }, limit: (v: number) => { limit = v; return q; },
      get: async () => { const docs = [...rows].filter(([id, d]) => d.pending === true && id > after).sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit).map(([id]) => snap(id)); return { docs, size: docs.length }; } };
    return q;
  } }), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: ReturnType<typeof ref>) => r.get(),
    set: (r: ReturnType<typeof ref>, data: Data) => r.set(data) }) } as unknown as Firestore;
  const events: FundamentalsUpdate[] = [], calls: string[] = [];
  const logs: Data[] = [];
  const log = { runId: "attempt-1", emit: (_level: string, event: string, data: Data) => logs.push({ event, ...data }) } as unknown as MaintenanceLog;
  const refresh = async (ticker: string) => { calls.push(ticker); rows.set(ticker, { pending: false, outcome: "ready", value: { metrics: { revenue: 10 }, fetchedAt: new Date().toISOString() } }); return null; };
  const marketCaps = async () => ({ processed: 0, failed: 0 });
  const publish = async (e: FundamentalsUpdate) => { events.push(e); };
  return { rows, db, log, events, calls, logs, refresh, marketCaps, publish };
}
const request = (companyIds = ["AMD", "NVDA"]): FundamentalsRequest => ({ version: 1, type: "fundamentals.refresh.requested",
  batchId: "batch-1", companyIds, reason: "scheduled_or_manual", requestedAt: "2026-09-27T00:00:00Z" });

test("batch validation rejects empty, oversized, duplicate and unsafe company lists", () => {
  for (const ids of [[], ["AMD", "AMD"], ["../_worker"], Array.from({ length: 21 }, (_, i) => `T${i}`)]) {
    assert.throws(() => parseFundamentalsRequest(request(ids)));
  }
  assert.throws(() => parseFundamentalsRequest({ ...request(), batchId: "../x" }));
  assert.deepEqual(parseFundamentalsRequest(request()), request());
});
test("batch publisher chunks all eligible companies and leaves fresh caches deferred", async () => {
  const f = fixture(Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`T${String(i).padStart(3, "0")}`, { pending: true }])));
  f.rows.set("FRESH", { pending: true, refreshAfter: Date.now() + 86400000 });
  const messages: FundamentalsRequest[] = [];
  const result = await publishPendingFundamentals(f.db, "run-1", async r => { messages.push(r); }, f.log);
  assert.equal(result.requested, 45);
  assert.deepEqual(messages.map(m => m.companyIds.length), [20, 20, 5]);
  assert.equal(new Set(messages.flatMap(m => m.companyIds)).size, 45);
  assert.ok(messages.every(m => f.rows.has(`_batch_${m.batchId}`)));
});
test("redelivery skips completed companies and duplicate result publication", async () => {
  const f = fixture();
  const a = await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  const b = await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  assert.equal(a.completed, 2); assert.equal("duplicate" in b && b.duplicate, true);
  assert.deepEqual(f.calls, ["AMD", "NVDA"]); assert.equal(f.events.length, 1);
});
test("partial failure publishes successful changes and retries only unfinished companies", async () => {
  const f = fixture();
  let fail = true;
  const refresh = async (ticker: string) => { if (ticker === "NVDA" && fail) throw new Error("temporary failure"); return f.refresh(ticker); };
  await assert.rejects(processFundamentalsBatch(request(), f.db, f.log, f.publish, { ...f, refresh }), /incomplete/);
  assert.deepEqual(f.events[0].companyIds, ["AMD"]);
  fail = false;
  const result = await processFundamentalsBatch(request(), f.db, f.log, f.publish, { ...f, refresh });
  assert.equal(result.completed, 2); assert.deepEqual(f.calls, ["AMD", "NVDA"]);
  assert.deepEqual(f.events[1].companyIds, ["AMD", "NVDA"]);
});
test("result publish failure resumes the durable outbox without another SEC fetch", async () => {
  const f = fixture();
  await assert.rejects(processFundamentalsBatch(request(), f.db, f.log, async () => { throw new Error("publish outage"); }, f), /publish outage/);
  await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  assert.equal(f.calls.length, 2); assert.equal(f.events.length, 1);
});
test("a crash after saving company data retains the before-version for resumed events", async () => {
  const f = fixture({ AMD: { value: { metrics: { revenue: 5 } } } });
  let first = true;
  const refresh = async (ticker: string) => {
    if (first) { first = false; await f.refresh(ticker); throw new Error("interrupted after save"); }
    return null; // Existing refresh routine returns its fresh cache on retry.
  };
  await assert.rejects(processFundamentalsBatch(request(["AMD"]), f.db, f.log, f.publish, { ...f, refresh }), /incomplete/);
  await processFundamentalsBatch(request(["AMD"]), f.db, f.log, f.publish, { ...f, refresh });
  assert.deepEqual(f.events[0].companyIds, ["AMD"]);
  assert.equal(f.calls.length, 1);
});
test("freshness-only changes do not publish fundamentals.updated", async () => {
  const f = fixture({ AMD: { value: { fetchedAt: "old", metrics: { revenue: 10 } } } });
  await processFundamentalsBatch(request(["AMD"]), f.db, f.log, f.publish, f);
  assert.equal(f.events.length, 0);
  assert.equal(fundamentalsVersion({ b: 2, a: 1 }), fundamentalsVersion({ a: 1, b: 2 }));
});
test("SEC provider blocks stop other companies and respect persisted cooldown", async () => {
  const f = fixture();
  const refresh = async () => { throw Object.assign(new Error("blocked"), { code: 429 }); };
  await assert.rejects(processFundamentalsBatch(request(), f.db, f.log, f.publish, { ...f, refresh }), /incomplete/);
  assert.ok(Number(f.rows.get("_worker")?.providerRetryAfter) > Date.now());
  await assert.rejects(processFundamentalsBatch(request(), f.db, f.log, f.publish, f), /incomplete/);
  assert.equal(f.calls.length, 0);
});
test("leased worker and exhausted time budget leave work unacknowledged", async () => {
  const f = fixture({ _worker: { leaseExpiresAtMs: Date.now() + 60000 } });
  await assert.rejects(processFundamentalsBatch(request(), f.db, f.log, f.publish, f), /busy/);
  f.rows.delete("_worker");
  await assert.rejects(processFundamentalsBatch(request(), f.db, f.log, f.publish, { ...f, deadline: Date.now() }), /incomplete/);
  assert.equal(f.calls.length, 0);
});
test("reusing a batch identifier with different contents is rejected", async () => {
  const f = fixture();
  await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  await assert.rejects(processFundamentalsBatch(request(["MU"]), f.db, f.log, f.publish, f), /different contents/);
});
