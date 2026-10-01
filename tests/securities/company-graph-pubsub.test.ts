import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { enqueueCompanyGraphRequest, claimCompanyGraphRequest, finishCompanyGraphRequest, GRAPH_LEASE_MS,
  listQueuedCompanyGraphRequests } from "../../src/lib/company-graph/requests";
import { companyGraphRequestId, parseCompanyGraphRequest } from "../../src/lib/company-graph/pubsub";
import { dispatchCompanyGraphRequest, processCompanyGraphJob, publishQueuedCompanyGraphRequests, verifyCompanyGraphDelivery } from "../../src/lib/company-graph/queue-worker";
import { runLatest10KCompanyGraphExtraction, shouldAdvanceLatestGraph } from "../../src/lib/company-graph/service";
import { createSecFilingDiscovered } from "../../src/lib/sec-filings/event";
import { COMPANY_GRAPH_EXTRACTION_VERSION, type CompanyGraphExtractionResult } from "../../src/lib/company-graph/types";
import { extractCompanyGraphRelationships } from "../../src/lib/company-graph/openai";

type Data = Record<string, unknown>;
function fixture(initial: Record<string, Data> = {}) {
  const rows = new Map<string, Data>(Object.entries(initial));
  let fail: ((path: string, data: Data) => boolean) | undefined;
  let beforeCommit: (() => void) | undefined;
  const snap = (path: string) => ({ id: path.split("/").at(-1)!, exists: rows.has(path), ref: ref(path),
    data: () => rows.has(path) ? structuredClone(rows.get(path)) : undefined, get: (key: string) => rows.get(path)?.[key] });
  const apply = (ops: Array<{ path: string; data?: Data }>) => {
    beforeCommit?.();
    for (const op of ops) if (fail?.(op.path, op.data ?? {})) throw new Error("Injected durable write failure");
    for (const op of ops) if (!op.data) rows.delete(op.path); else rows.set(op.path, { ...rows.get(op.path), ...structuredClone(op.data) });
  };
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)!, get: async () => snap(path),
    set: async (data: Data) => apply([{ path, data }]), create: async (data: Data) => { assert.ok(!rows.has(path)); apply([{ path, data }]); } });
  const collection = (name: string) => {
    let clauses: Array<[string, string, unknown]> = [], count = Infinity, cursor = "";
    const q = { doc: (id: string) => ref(`${name}/${id}`),
      where: (field: unknown, op: string, value: unknown) => { clauses = [...clauses, [typeof field === "string" ? field : "__name__", op, value]]; return q; },
      orderBy: () => q, limit: (value: number) => { count = value; return q; }, startAfter: (value: string) => { cursor = value; return q; },
      get: async () => {
        const docs = [...rows].filter(([path, data]) => path.startsWith(`${name}/`) && path.slice(name.length + 1) > cursor
          && clauses.every(([field, op, value]) => {
            const actual = field === "__name__" ? path.slice(name.length + 1) : data[field];
            return op === "==" ? actual === value : op === "in" ? (value as unknown[]).includes(actual)
              : op === ">=" ? String(actual) >= String(value) : op === "<" ? String(actual) < String(value) : false;
          })).sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([path]) => snap(path));
        return { docs, size: docs.length, empty: docs.length === 0 };
      } };
    return q;
  };
  const db = { collection, runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const ops: Array<{ path: string; data?: Data }> = [];
    const result = await fn({ get: async (r: ReturnType<typeof ref>) => r.get(),
      set: (r: ReturnType<typeof ref>, data: Data) => { ops.push({ path: r.path, data }); },
      delete: (r: ReturnType<typeof ref>) => { ops.push({ path: r.path }); } });
    apply(ops); return result;
  } } as unknown as Firestore;
  return { db, rows, inject: (predicate?: typeof fail) => { fail = predicate; }, beforeCommit: (fn?: () => void) => { beforeCommit = fn; } };
}
const now = Date.parse("2026-10-01T12:00:00Z");
const log = (runId = "attempt-1") => ({ runId, emit() {} }) as unknown as MaintenanceLog;
const company = { ticker: "AMD", cik: "0000002488", name: "Advanced Micro Devices", exchange: "NASDAQ" };
const filing = { accessionNumber: "0000002488-26-000001", filingDate: "2026-02-01", reportDate: null,
  primaryDocument: "amd-10k.htm", filingUrl: "https://www.sec.gov/Archives/edgar/data/2488/000000248826000001/amd-10k.htm" };
const event = (ticker = "AMD", accession = filing.accessionNumber, date = filing.filingDate) => createSecFilingDiscovered({
  companyId: ticker, cik: company.cik, accessionNumber: accession, form: "10-K", filingDate: date,
  primaryDocument: filing.primaryDocument, isXbrl: true, discoveredAt: "2026-10-01T12:00:00Z" });
function extractionFixture() {
  const f = fixture({ "companies/US:AMD": { name: company.name } });
  const calls = { resolve: 0, latest: 0, sections: 0, extract: 0, responseIds: [] as Array<string | undefined> };
  const deps = { db: f.db, now: () => now,
    resolve: async () => { calls.resolve++; return company; }, latest: async () => { calls.latest++; return filing; },
    sections: async () => { calls.sections++; return [{ id: "item1" as const, title: "Business", text: "We compete with NVIDIA." }, { id: "item1a" as const, title: "Risks", text: "" }]; },
    extract: async (input: Parameters<typeof extractCompanyGraphRelationships>[0]) => {
      calls.extract++; calls.responseIds.push(input.responseId); await input.onResponseCreated?.("resp_test");
      return { model: "mock-model", responseId: "resp_test", outputText: "mock", usage: null,
        relationships: [{ sourceName: company.name, targetName: "NVIDIA", targetType: "company" as const,
          relationshipType: "COMPETES_WITH" as const, direction: "bidirectional" as const, evidenceText: "We compete with NVIDIA.", section: "item1" as const, confidence: 0.9 }] };
    }, usage: async () => null };
  return { ...f, calls, deps };
}
const extractInput = { ticker: "AMD", dryRun: false, requestId: "manual_test", requestedAt: "2026-10-01T12:00:00Z" };

test("queue first request, repeated intent and failed retry retain one stable generation", async () => {
  const f = fixture();
  const first = await enqueueCompanyGraphRequest("$amd", { db: f.db, now });
  assert.equal(first.status, "QUEUED");
  const again = await enqueueCompanyGraphRequest("AMD", { db: f.db, now: now + 1 });
  assert.equal(again.status, "ALREADY_QUEUED"); assert.deepEqual(first.request, again.request);
  await claimCompanyGraphRequest(first.request!, "owner", f.db, now);
  await finishCompanyGraphRequest(first.request!, "owner", { error: "retry" }, f.db, now);
  const retry = await enqueueCompanyGraphRequest("AMD", { db: f.db, now: now + 2, replay: true });
  assert.deepEqual(retry.request, first.request);
  assert.equal(f.rows.get("company_research_requests/AMD")?.requestedCount, 3);
});
test("lease expiry recovers; payload collision and late completion cannot change another generation", async () => {
  const f = fixture(), q = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
  await claimCompanyGraphRequest(q.request!, "one", f.db, now);
  await assert.rejects(claimCompanyGraphRequest(q.request!, "two", f.db, now + 1), /busy/);
  await assert.rejects(claimCompanyGraphRequest({ ...q.request!, force: true }, "two", f.db, now + GRAPH_LEASE_MS), /different contents/);
  await claimCompanyGraphRequest(q.request!, "two", f.db, now + GRAPH_LEASE_MS);
  assert.equal(await finishCompanyGraphRequest(q.request!, "one", { edgeCount: 10 }, f.db, now), false);
  await finishCompanyGraphRequest(q.request!, "two", { edgeCount: 1 }, f.db, now);
  const next = await enqueueCompanyGraphRequest("AMD", { force: true, db: f.db, now: now + GRAPH_LEASE_MS + 1 });
  assert.equal(next.request?.generation, 2);
  assert.equal(await finishCompanyGraphRequest(q.request!, "two", { edgeCount: 10 }, f.db, now), false);
  assert.equal(await claimCompanyGraphRequest(q.request!, "three", f.db, now), "obsolete");
});
test("message parser rejects unsafe identity, changed generation and malformed payloads", () => {
  const request = { version: 1, type: "company.graph.extract.requested", ticker: "AMD", generation: 1,
    requestId: companyGraphRequestId("AMD", 1), batchId: companyGraphRequestId("AMD", 1), requestedAt: new Date(now).toISOString(), force: false };
  assert.deepEqual(parseCompanyGraphRequest(request), request);
  for (const changed of [{ ticker: "../AMD" }, { generation: 2 }, { force: "true" }, { requestedAt: "bad" }, { batchId: "other" }]) assert.throws(() => parseCompanyGraphRequest({ ...request, ...changed }));
});
test("publisher retries uncertain publication with same identity but never automatically republishes confirmed deliveries", async () => {
  const f = fixture(), q = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
  const ids: string[] = [];
  await assert.rejects(dispatchCompanyGraphRequest(q.request!, f.db, async r => { ids.push(r.requestId); throw Error("ambiguous"); }, now), /ambiguous/);
  await dispatchCompanyGraphRequest(q.request!, f.db, async r => { ids.push(r.requestId); }, now + 60_001);
  assert.deepEqual(ids, [q.request!.requestId, q.request!.requestId]);
  const result = await publishQueuedCompanyGraphRequests({}, { db: f.db, now: now + GRAPH_LEASE_MS * 10, publish: async () => { throw Error("must not publish"); } });
  assert.equal(result.items.length, 0);
});
test("publisher scan cursor reaches work after a thousand stuck records", async () => {
  const f = fixture();
  for (let i = 0; i < 1005; i++) f.rows.set(`company_research_requests/T${String(i).padStart(4, "0")}`, { ticker: `T${String(i).padStart(4, "0")}`, status: "QUEUED", dispatchedAt: "confirmed" });
  await enqueueCompanyGraphRequest("ZZZ", { db: f.db, now });
  assert.equal((await listQueuedCompanyGraphRequests(1, f.db, now, { unpublishedOnly: true })).length, 0);
  assert.equal((await listQueuedCompanyGraphRequests(1, f.db, now, { unpublishedOnly: true }))[0].ticker, "ZZZ");
});
test("processing gate and ineligible filing never call SEC/OpenAI", async () => {
  const f = fixture(); let calls = 0;
  const deps = { enabled: false, extract: async () => { calls++; throw Error("forbidden"); } };
  await assert.rejects(processCompanyGraphJob(event(), f.db, log(), deps), /disabled/);
  assert.equal((await processCompanyGraphJob({ ...event(), form: "10-Q" }, f.db, log(), deps)).status, "ineligible");
  assert.equal(calls, 0);
});
test("exact event pins accession, preserves company name, and older events cannot regress latest pointer", async () => {
  const f = extractionFixture();
  const latest = await runLatest10KCompanyGraphExtraction({ ticker: "AMD", filing: event("AMD", "0000002488-26-000002", "2026-03-01"), dryRun: false }, f.deps);
  const older = await runLatest10KCompanyGraphExtraction({ ticker: "AMD", filing: event(), dryRun: false }, f.deps);
  assert.equal(latest.companyName, company.name); assert.equal(older.filing.accessionNumber, filing.accessionNumber);
  assert.equal(f.calls.latest, 0); assert.equal(f.calls.resolve, 0);
  assert.equal((f.rows.get("company_research_runs/AMD_latest_10k")?.result as CompanyGraphExtractionResult).runId, latest.runId);
  assert.equal(older.filing.reportDate, null);
});
for (const stage of ["section", "edge", "latest", "completion"] as const) test(`recovery after ${stage} write failure completes without repeating durable provider work`, async () => {
  const f = extractionFixture();
  f.inject((path, data) => stage === "section" ? path.endsWith("_item1a") : stage === "edge" ? path.startsWith("company_relationships/")
    : stage === "latest" ? path.endsWith("AMD_latest_10k") : path.includes("_graph_run_") && data.completed === true);
  await assert.rejects(runLatest10KCompanyGraphExtraction(extractInput, f.deps), /Injected/);
  const firstCalls = f.calls.extract;
  f.inject();
  const result = await runLatest10KCompanyGraphExtraction(extractInput, f.deps);
  assert.equal(result.edges.length, 1); assert.equal(f.calls.extract, stage === "section" ? 1 : firstCalls);
  assert.equal(f.rows.get("company_research_runs/AMD_latest_10k")?.status, "COMPLETED");
  assert.equal([...f.rows].filter(([path]) => path.startsWith("company_relationships/")).length, 1);
});
test("saved response identity resumes after provider-result checkpoint failure", async () => {
  const f = extractionFixture(); f.inject((_path, data) => Boolean(data.providerResult));
  await assert.rejects(runLatest10KCompanyGraphExtraction(extractInput, f.deps), /Injected/);
  f.inject(); await runLatest10KCompanyGraphExtraction(extractInput, f.deps);
  assert.deepEqual(f.calls.responseIds, [undefined, "resp_test"]);
});
test("legacy incomplete filing cache is repaired instead of early-returned", async () => {
  const source = extractionFixture(); const result = await runLatest10KCompanyGraphExtraction(extractInput, source.deps);
  const f = extractionFixture(); f.rows.set(`sec_filings/${filing.accessionNumber}`, { companyGraphLatestResult: { result } });
  await runLatest10KCompanyGraphExtraction(extractInput, f.deps);
  assert.equal(f.calls.extract, 0); assert.equal(f.calls.sections, 1);
  assert.equal(f.rows.get("company_research_runs/AMD_latest_10k")?.status, "COMPLETED");
  assert.ok(f.rows.get(`company_relationships/filing:${result.edges[0].id}`));
});
test("two ticker listings sharing an accession do not reuse each other's results", async () => {
  const f = extractionFixture(); await runLatest10KCompanyGraphExtraction({ ticker: "AMD", filing: event(), dryRun: false }, f.deps);
  const second = await runLatest10KCompanyGraphExtraction({ ticker: "AMDX", filing: event("AMDX"), dryRun: false }, f.deps);
  assert.equal(second.ticker, "AMDX"); assert.equal(f.calls.extract, 2);
  assert.ok(f.rows.has("company_research_runs/AMD_latest_10k")); assert.ok(f.rows.has("company_research_runs/AMDX_latest_10k"));
});
test("editor decisions survive forced retry and stale cleanup", async () => {
  const f = extractionFixture(); const result = await runLatest10KCompanyGraphExtraction(extractInput, f.deps);
  const key = `company_relationships/filing:${result.edges[0].id}`;
  f.rows.set(key, { ...f.rows.get(key), status: "PUBLISHED", note: "editor decision" });
  const staleKey = `company_relationships/filing:AMD_${filing.accessionNumber.replace(/-/g, "")}_stale`;
  f.rows.set(staleKey, { status: "WITHDRAWN", note: "withdrawn" });
  const reviewKey = `${staleKey}_review`; f.rows.set(reviewKey, { status: "NEEDS_REVIEW" });
  await runLatest10KCompanyGraphExtraction({ ...extractInput, force: true, requestId: "force_test" }, f.deps);
  assert.equal(f.rows.get(key)?.status, "PUBLISHED"); assert.equal(f.rows.get(key)?.note, "editor decision");
  assert.equal(f.rows.get(staleKey)?.status, "WITHDRAWN"); assert.equal(f.rows.has(reviewKey), false);
});
test("legacy completed cache remains valid and zero-edge completed graphs are available", async () => {
  const f = extractionFixture(); const result = await runLatest10KCompanyGraphExtraction(extractInput, f.deps);
  f.rows.set("company_research_runs/AMD_latest_10k", { status: "COMPLETED", extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, edgeCount: 0, result: { ...result, edges: [] } });
  assert.equal((await enqueueCompanyGraphRequest("AMD", { db: f.db, now })).status, "AVAILABLE");
});
test("older forced generation does not replace newer same-filing run", async () => {
  const f = extractionFixture(); const newer = await runLatest10KCompanyGraphExtraction({ ...extractInput, force: true, requestId: "new", requestedAt: "2026-10-01T12:00:10Z" }, f.deps);
  const older = await runLatest10KCompanyGraphExtraction({ ...extractInput, force: true, requestId: "old", requestedAt: "2026-10-01T12:00:00Z" }, f.deps);
  assert.equal(older.runId, newer.runId); assert.equal(f.calls.extract, 1);
  assert.equal(shouldAdvanceLatestGraph({ result: newer, generationAt: "2026-10-01T12:00:10Z" }, older, "2026-10-01T12:00:00Z"), false);
});
test("verification checks initial and duplicate delivery using cached data while processing is disabled", async () => {
  const f = extractionFixture(); await runLatest10KCompanyGraphExtraction(extractInput, f.deps);
  let time = now, deliveries = 0;
  const result = await verifyCompanyGraphDelivery(f.db, async request => {
    deliveries++; await processCompanyGraphJob(request, f.db, log(`receipt-${deliveries}`), { enabled: false, extract: async () => { throw Error("forbidden"); } });
  }, { now: () => time, sleep: async ms => { time += ms; }, id: "probe" });
  assert.equal(result.duplicateVerified, true); assert.equal(result.providerCalls, 0); assert.equal(deliveries, 2);
  assert.equal([...f.rows].filter(([, data]) => data.status === "COMPLETED").length, 1);
});

test("expired worker is fenced before provider checkpoint and graph writes", async () => {
  const f = extractionFixture();
  const realExtract = f.deps.extract;
  f.deps.extract = async input => {
    const result = await realExtract(input);
    f.rows.set("company_research_runs/_graph_lock_AMD", { leaseOwner: "replacement", leaseExpiresAtMs: now + GRAPH_LEASE_MS });
    return result;
  };
  await assert.rejects(runLatest10KCompanyGraphExtraction(extractInput, f.deps), /lease expired/);
  assert.equal(f.rows.has("company_research_runs/AMD_latest_10k"), false);
  assert.equal([...f.rows.keys()].some(path => path.startsWith("company_relationships/")), false);
  assert.equal(f.rows.get("company_research_runs/_graph_lock_AMD")?.leaseOwner, "replacement");
});
test("operator force recovers a failed generation while normal retry remains stable", async () => {
  const f = fixture(), first = await enqueueCompanyGraphRequest("AMD", { db: f.db, now });
  await claimCompanyGraphRequest(first.request!, "one", f.db, now);
  await finishCompanyGraphRequest(first.request!, "one", { error: "provider terminal failure" }, f.db, now);
  const next = await enqueueCompanyGraphRequest("AMD", { db: f.db, now: now + 1, replay: true, force: true });
  assert.equal(next.request?.generation, 2); assert.equal(next.request?.force, true);
});
test("provider resumes stored response via GET and never starts another paid POST", async t => {
  const priorKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-local-test-only";
  t.after(() => { if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey; });
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body });
    return Response.json({ id: "resp_saved", model: "saved-model", status: "completed", output_text: '{"relationships":[]}', usage: {} });
  });
  const result = await extractCompanyGraphRelationships({ companyName: "AMD", ticker: "AMD", accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate, extractionText: "text", responseId: "resp_saved" });
  assert.equal(calls.length, 1); assert.equal(calls[0].method, "GET"); assert.equal(calls[0].body, undefined);
  assert.match(calls[0].url, /\/responses\/resp_saved$/); assert.equal(result.model, "saved-model");
});
test("provider creation saves response identity before polling; checkpoint failure stops without resubmit", async t => {
  const priorKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-local-test-only";
  t.after(() => { if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    calls++; const body = JSON.parse(String(init?.body)); assert.equal(body.background, true); assert.equal(body.store, true);
    return Response.json({ id: "resp_saved", status: "queued" });
  });
  await assert.rejects(extractCompanyGraphRelationships({ companyName: "AMD", ticker: "AMD", accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate, extractionText: "text", onResponseCreated: async id => { assert.equal(id, "resp_saved"); throw Error("checkpoint failed"); } }), /checkpoint failed/);
  assert.equal(calls, 1);
});
for (const status of ["failed", "incomplete", "cancelled"]) test(`provider terminal ${status} requests operator review without another POST`, async t => {
  const priorKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-local-test-only";
  t.after(() => { if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => { calls++; assert.equal(init?.method, "GET"); return Response.json({ id: "resp_saved", status }); });
  await assert.rejects(extractCompanyGraphRelationships({ companyName: "AMD", ticker: "AMD", accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate, extractionText: "text", responseId: "resp_saved" }), /operator review/);
  assert.equal(calls, 1);
});
test("provider polling respects abort and does not start replacement paid work", async t => {
  const priorKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-local-test-only";
  t.after(() => { if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ id: "resp_saved", status: "in_progress" }); });
  await assert.rejects(extractCompanyGraphRelationships({ companyName: "AMD", ticker: "AMD", accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate, extractionText: "text", responseId: "resp_saved", signal: AbortSignal.abort() }), /abort/i);
  assert.equal(calls, 1);
});
test("same-millisecond forced generations preserve the higher generation", async () => {
  const f = extractionFixture();
  const newer = await runLatest10KCompanyGraphExtraction({ ...extractInput, force: true, requestId: "generation_2", requestGeneration: 2 }, f.deps);
  const older = await runLatest10KCompanyGraphExtraction({ ...extractInput, force: true, requestId: "generation_1", requestGeneration: 1 }, f.deps);
  assert.equal(older.runId, newer.runId); assert.equal(f.calls.extract, 1);
});
