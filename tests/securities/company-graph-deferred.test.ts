import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { GraphBudgetExceededError } from "../../src/lib/company-graph/budget";
import { deferCompanyGraphRequest, enqueueCompanyGraphRequest } from "../../src/lib/company-graph/requests";
import { dispatchCompanyGraphRequest, processCompanyGraphJob, publishQueuedCompanyGraphRequests } from "../../src/lib/company-graph/queue-worker";
import { completeCompanyGraphFilingDeferral, deferCompanyGraphFiling, dispatchDeferredCompanyGraphFiling,
  listDeferredCompanyGraphFilings } from "../../src/lib/company-graph/deferred-work";
import { createSecFilingDiscovered, type SecFilingDiscovered } from "../../src/lib/sec-filings/event";
import type { CompanyGraphExtractionResult } from "../../src/lib/company-graph/types";
import { runLatest10KCompanyGraphExtraction } from "../../src/lib/company-graph/service";

type Data = Record<string, unknown>;
function enableMockedAdmission(t: TestContext) {
  const previous = process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED = "1";
  t.after(() => { if (previous === undefined) delete process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; else process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED = previous; });
}
function fixture() {
  const rows = new Map<string, Data>();
  const writes: string[] = [], queries: number[] = [];
  let failure: ((path: string, data: Data) => boolean) | undefined;
  let transactions = Promise.resolve();
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, data: () => structuredClone(rows.get(path)) });
  const apply = (ops: Array<{ path: string; data: Data }>) => {
    if (ops.some(op => failure?.(op.path, op.data))) throw new Error("Durable write failed");
    for (const op of ops) { rows.set(op.path, { ...rows.get(op.path), ...structuredClone(op.data) }); writes.push(op.path); }
  };
  const ref = (path: string) => ({ path, get: async () => snapshot(path), set: async (data: Data) => apply([{ path, data }]) });
  const collection = (name: string) => {
    const clauses: Array<[string, string, unknown]> = [];
    let count = Infinity, cursor = "";
    const query = { doc: (id: string) => ref(`${name}/${id}`),
      where: (field: unknown, op: string, value: unknown) => { clauses.push([typeof field === "string" ? field : "__name__", op, value]); return query; },
      orderBy: () => query, limit: (value: number) => { count = value; return query; },
      startAfter: (value: string) => { cursor = value; return query; },
      get: async () => {
        if (name !== "company_relationships") {
          assert.ok(Number.isFinite(count), "Every queue collection query must have a bound"); queries.push(count);
        }
        const docs = [...rows].filter(([path, data]) => path.startsWith(`${name}/`) && path.slice(name.length + 1) > cursor
          && clauses.every(([field, op, value]) => {
            const actual = field === "__name__" ? path.slice(name.length + 1) : data[field];
            return op === "==" ? actual === value : op === "in" ? (value as unknown[]).includes(actual)
              : op === ">=" ? String(actual) >= String(value) : op === "<" ? String(actual) < String(value) : false;
          })).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, count).map(([path]) => snapshot(path));
        return { docs };
      } };
    return query;
  };
  const db = { collection, runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
    const result = transactions.then(async () => {
      const ops: Array<{ path: string; data: Data }> = [];
      const value = await fn({ get: async (r: ReturnType<typeof ref>) => r.get(),
        set: (r: ReturnType<typeof ref>, data: Data) => { ops.push({ path: r.path, data }); } });
      apply(ops); return value;
    });
    transactions = result.then(() => undefined, () => undefined); return result;
  } } as unknown as Firestore;
  return { db, rows, writes, queries, inject: (value?: typeof failure) => { failure = value; } };
}
const now = Date.parse("2026-10-01T22:00:00Z");
const retryAtMs = new GraphBudgetExceededError(now).retryAtMs;
const log: MaintenanceLog = { runId: "00000000-0000-0000-0000-000000000001", emit() {}, stage() {} };
const filing = (ticker = "AMD") => createSecFilingDiscovered({ companyId: ticker, cik: "0000002488",
  accessionNumber: "0000002488-26-000001", form: "10-K", filingDate: "2026-02-01", primaryDocument: "amd-10k.htm",
  isXbrl: true, discoveredAt: new Date(now).toISOString() });
const pathFor = (event: SecFilingDiscovered) => `company_research_runs/_graph_deferred_${event.eventId}`;
const exhausted = { enabled: true, now: () => now, extract: async () => { throw new GraphBudgetExceededError(now); } };
const success = { enabled: true, now: () => retryAtMs, extract: async () => ({ ticker: "AMD", runId: "completed", edges: [], cached: false } as unknown as CompanyGraphExtractionResult) };

test("typed budget exhaustion durably defers the same manual generation and ACKs early duplicate delivery", async t => {
  enableMockedAdmission(t);
  const f = fixture(), queued = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
  f.rows.set("company_research_requests/AMD", { ...f.rows.get("company_research_requests/AMD"), dispatchedAt: "published" });
  assert.equal((await processCompanyGraphJob(queued.request!, f.db, log, exhausted)).status, "deferred");
  const saved = f.rows.get("company_research_requests/AMD")!;
  assert.equal(saved.status, "QUEUED"); assert.equal(saved.nextAttemptAtMs, retryAtMs);
  assert.equal(saved.dispatchedAt, null); assert.equal(saved.processingRunId, null);
  assert.equal(saved.generation, queued.request!.generation); assert.equal(saved.requestId, queued.request!.requestId);
  let extracted = 0;
  const duplicate = await processCompanyGraphJob(queued.request!, f.db, log, { ...exhausted, extract: async () => { extracted++; throw Error("forbidden"); } });
  assert.equal(duplicate.status, "deferred"); assert.equal(extracted, 0);
  const sent: unknown[] = [];
  const replay = await publishQueuedCompanyGraphRequests({}, { db: f.db, now: retryAtMs, publish: async request => { sent.push(request); } });
  assert.equal(replay.published, 1); assert.deepEqual(sent, [queued.request]);
});

test("a named lookalike or uncertain provider failure remains an error without budget deferral", async () => {
  for (const error of [Object.assign(new Error("unknown pricing"), { name: "GraphBudgetExceededError", retryAtMs }), new Error("ambiguous provider outcome")]) {
    const f = fixture(), queued = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
    await assert.rejects(processCompanyGraphJob(queued.request!, f.db, log, { ...exhausted, extract: async () => { throw error; } }), error);
    assert.equal(f.rows.get("company_research_requests/AMD")?.status, "FAILED");
    assert.equal(f.rows.get("company_research_requests/AMD")?.budgetDeferredUntilMs, 0);
    await assert.rejects(processCompanyGraphJob(filing(), f.db, log, { ...exhausted, extract: async () => { throw error; } }), error);
    assert.equal(f.rows.has(pathFor(filing())), false);
  }
});

test("budget exhaustion is not ACKed when durable deferral fails or manual ownership changed", async () => {
  const f = fixture(), queued = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
  f.inject((_path, data) => data.budgetDeferredUntilMs === retryAtMs || data.deferredStatus === "PENDING");
  await assert.rejects(processCompanyGraphJob(queued.request!, f.db, log, exhausted), /Durable write failed/);
  await assert.rejects(processCompanyGraphJob(filing(), f.db, log, exhausted), /Durable write failed/);
  assert.equal(f.rows.has(pathFor(filing())), false);
  f.inject();
  await assert.rejects(deferCompanyGraphRequest(queued.request!, "obsolete-owner", retryAtMs, f.db, now), /ownership changed/);
});

test("filing deferral preserves the exact event through due replay and records successful consumption", async t => {
  enableMockedAdmission(t);
  const f = fixture(), event = filing();
  const result = await processCompanyGraphJob(event, f.db, log, exhausted);
  assert.equal(result.status, "deferred"); assert.deepEqual(f.rows.get(pathFor(event))?.event, event);
  assert.equal(f.rows.has(`company_research_runs/_graph_filing_receipt_${event.eventId}`), false);
  assert.equal((await listDeferredCompanyGraphFilings(5, f.db, now)).length, 0);
  let calls = 0;
  assert.equal((await processCompanyGraphJob(event, f.db, log, { ...exhausted, extract: async () => { calls++; throw Error("forbidden"); } })).status, "deferred");
  assert.equal(calls, 0);
  const changed = { ...event, discoveredAt: new Date(now + 1).toISOString() };
  await assert.rejects(processCompanyGraphJob(changed, f.db, log, exhausted), /different contents/);
  const sent: unknown[] = [];
  const replay = await publishQueuedCompanyGraphRequests({}, { db: f.db, now: retryAtMs, publishFiling: async value => { sent.push(value); } });
  assert.equal(replay.published, 1); assert.deepEqual(sent, [event]);
  assert.equal(f.rows.get(pathFor(event))?.deferredStatus, "PUBLISHED");
  await processCompanyGraphJob(event, f.db, log, success);
  assert.equal(f.rows.get(pathFor(event))?.deferredStatus, "COMPLETED");
  assert.equal((await listDeferredCompanyGraphFilings(5, f.db, retryAtMs)).length, 0);
});

test("manual and filing replay share the five-publication cap and alternate one-slot sweeps fairly", async t => {
  enableMockedAdmission(t);
  const f = fixture();
  for (const ticker of ["A", "B", "C", "D", "E", "F"]) {
    await enqueueCompanyGraphRequest(ticker, { db: f.db, now });
    await deferCompanyGraphFiling(filing(ticker), retryAtMs, f.db, now);
  }
  const sources: string[] = [];
  const deps = { db: f.db, now: retryAtMs, publish: async () => { sources.push("manual"); }, publishFiling: async () => { sources.push("filing"); } };
  assert.equal((await publishQueuedCompanyGraphRequests({ limit: 100 }, deps)).published, 5);
  assert.deepEqual(sources, ["manual", "filing", "manual", "filing", "manual"]);
  assert.equal((await publishQueuedCompanyGraphRequests({ limit: 1 }, deps)).published, 1);
  assert.equal(sources.at(-1), "filing");
});

test("preview is write-free and unavailable budget cannot publish or advance cursors", async () => {
  const f = fixture();
  await enqueueCompanyGraphRequest("AMD", { db: f.db, now }); await deferCompanyGraphFiling(filing(), retryAtMs, f.db, now);
  const before = structuredClone([...f.rows]); const writeCount = f.writes.length;
  const deps = { db: f.db, now: retryAtMs, budgetAvailability: async () => ({ available: false, retryAtMs }),
    publish: async () => { throw Error("forbidden"); }, publishFiling: async () => { throw Error("forbidden"); } };
  const preview = await publishQueuedCompanyGraphRequests({ limit: 5, preview: true }, deps);
  assert.equal(preview.items.length, 2); assert.equal(preview.published, 0);
  assert.deepEqual([...f.rows], before); assert.equal(f.writes.length, writeCount);
  assert.equal((await publishQueuedCompanyGraphRequests({}, deps)).published, 0);
  assert.deepEqual([...f.rows], before); assert.equal(f.writes.length, writeCount);
  await assert.rejects(publishQueuedCompanyGraphRequests({}, { ...deps, budgetAvailability: async () => { throw Error("datastore unavailable"); } }), /datastore unavailable/);
  assert.deepEqual([...f.rows], before);
});

test("bounded filing cursor reaches due work beyond a thousand records", async () => {
  const f = fixture(), event = filing();
  for (let i = 0; i < 1005; i++) f.rows.set(`company_research_runs/_graph_deferred_sec_000_${String(i).padStart(4, "0")}`, { deferredStatus: "PENDING", nextAttemptAtMs: retryAtMs + 1 });
  await deferCompanyGraphFiling(event, retryAtMs, f.db, now);
  assert.equal((await listDeferredCompanyGraphFilings(1, f.db, retryAtMs)).length, 0);
  assert.equal(f.queries.length, 10); assert.ok(f.queries.every(limit => limit === 100));
  assert.deepEqual((await listDeferredCompanyGraphFilings(1, f.db, retryAtMs)).map(row => row.event), [event]);
});

test("uncertain replay publication retries unchanged after backoff and concurrent publishers share one lease", async () => {
  const f = fixture(), event = filing(), sent: SecFilingDiscovered[] = [];
  await deferCompanyGraphFiling(event, retryAtMs, f.db, now);
  await assert.rejects(dispatchDeferredCompanyGraphFiling(event, f.db, async value => { sent.push(value); throw Error("ambiguous"); }, retryAtMs), /ambiguous/);
  assert.equal((await listDeferredCompanyGraphFilings(5, f.db, retryAtMs)).length, 0);
  const results = await Promise.all([0, 1].map(() => dispatchDeferredCompanyGraphFiling(event, f.db, async value => { sent.push(value); }, retryAtMs + 60_000)));
  assert.equal(results.filter(result => result.status === "PUBLISHED").length, 1);
  assert.deepEqual(sent, [event, event]);
});

test("fast budget deferral cannot be overwritten by manual publication completion", async () => {
  for (const fails of [false, true]) {
    const f = fixture(), queued = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
    const dispatch = dispatchCompanyGraphRequest(queued.request!, f.db, async request => {
      await processCompanyGraphJob(request, f.db, log, exhausted);
      if (fails) throw Error("ambiguous");
    }, now);
    if (fails) await assert.rejects(dispatch, /ambiguous/); else await dispatch;
    assert.equal(f.rows.get("company_research_requests/AMD")?.dispatchedAt, null);
    assert.equal(f.rows.get("company_research_requests/AMD")?.nextAttemptAtMs, retryAtMs);
  }
});

test("fast filing consumption cannot be overwritten by publication completion or failure", async () => {
  for (const fails of [false, true]) {
    const f = fixture(), event = filing(); await deferCompanyGraphFiling(event, retryAtMs, f.db, now);
    const nextDay = new GraphBudgetExceededError(retryAtMs).retryAtMs;
    const dispatch = dispatchDeferredCompanyGraphFiling(event, f.db, async value => {
      await deferCompanyGraphFiling(value, nextDay, f.db, retryAtMs);
      if (fails) throw Error("ambiguous");
    }, retryAtMs);
    if (fails) await assert.rejects(dispatch, /ambiguous/); else await dispatch;
    assert.equal(f.rows.get(pathFor(event))?.deferredStatus, "PENDING");
    assert.equal(f.rows.get(pathFor(event))?.nextAttemptAtMs, nextDay);
    await dispatchDeferredCompanyGraphFiling(event, f.db, value => completeCompanyGraphFilingDeferral(value, f.db, nextDay), nextDay);
    assert.equal(f.rows.get(pathFor(event))?.deferredStatus, "COMPLETED");
  }
});

test("expired publication lease recovers and fences the abandoned publisher's late checkpoint", async () => {
  const f = fixture(), event = filing(); await deferCompanyGraphFiling(event, retryAtMs, f.db, now);
  let started!: () => void, release!: () => void;
  const accepted = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = dispatchDeferredCompanyGraphFiling(event, f.db, async () => { started(); await pending; }, retryAtMs);
  await accepted;
  const nextDay = new GraphBudgetExceededError(retryAtMs).retryAtMs;
  const second = await dispatchDeferredCompanyGraphFiling(event, f.db,
    value => deferCompanyGraphFiling(value, nextDay, f.db, retryAtMs + 30_001), retryAtMs + 30_001);
  assert.equal(second.status, "PUBLISHED"); release(); await first;
  assert.equal(f.rows.get(pathFor(event))?.deferredStatus, "PENDING");
  assert.equal(f.rows.get(pathFor(event))?.nextAttemptAtMs, nextDay);
});

test("a deferral that crosses midnight is immediately due rather than lost at the persistence boundary", async () => {
  const f = fixture(), event = filing();
  await deferCompanyGraphFiling(event, retryAtMs, f.db, retryAtMs + 1);
  assert.deepEqual((await listDeferredCompanyGraphFilings(1, f.db, retryAtMs + 1)).map(row => row.event), [event]);
});

test("filing completion receipt is required before ACK and failed writes retry from the completed graph cache", async () => {
  const f = fixture(), event = filing(), receiptPath = `company_research_runs/_graph_filing_receipt_${event.eventId}`;
  let providerCalls = 0;
  const extract: typeof runLatest10KCompanyGraphExtraction = input => runLatest10KCompanyGraphExtraction(input, {
    db: f.db, now: () => now,
    sections: async () => [{ id: "item1", title: "Business", text: "We manufacture processors." }, { id: "item1a", title: "Risks", text: "" }],
    extract: async () => { providerCalls++; return { model: "mock-model", responseId: "resp_mock", outputText: "{}", usage: null, relationships: [] }; },
    usage: async () => null,
  });
  f.inject(path => path === receiptPath);
  await assert.rejects(processCompanyGraphJob(event, f.db, log, { enabled: true, now: () => now, extract }), /Durable write failed/);
  assert.equal(f.rows.has(receiptPath), false); assert.equal(providerCalls, 1);
  assert.equal(f.rows.get("company_research_runs/AMD_latest_10k")?.status, "COMPLETED");
  f.inject();
  const result = await processCompanyGraphJob(event, f.db, log, { enabled: true, now: () => now, extract });
  assert.ok("cached" in result && "runId" in result);
  assert.equal(result.cached, true); assert.equal(providerCalls, 1);
  assert.deepEqual(f.rows.get(receiptPath), { completed: true, eventId: event.eventId, companyId: "AMD",
    accessionNumber: event.accessionNumber, runId: result.runId, updatedAt: new Date(now).toISOString() });
  const skipped = { ...filing("OTHER"), form: "10-Q" as const };
  assert.equal((await processCompanyGraphJob(skipped, f.db, log, exhausted)).status, "ineligible");
  assert.equal(f.rows.has(`company_research_runs/_graph_filing_receipt_${skipped.eventId}`), false);
});
