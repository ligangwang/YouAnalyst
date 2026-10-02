import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { verifyLiveCompanyGraph } from "../../src/lib/company-graph/live-verification";
import { parseCompanyGraphPublisherArgs } from "../../src/lib/company-graph/cli";
import { createSecFilingDiscovered } from "../../src/lib/sec-filings/event";
import type { CompanyGraphRequest } from "../../src/lib/company-graph/pubsub";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "../../src/lib/company-graph/types";

type Row = Record<string, unknown>;
const tree = "a".repeat(40), now = Date.parse("2026-10-01T12:00:00Z");
const event = createSecFilingDiscovered({ companyId: "NVDA", cik: "0001045810", accessionNumber: "0001045810-26-000001",
  form: "10-K", filingDate: "2026-02-01", primaryDocument: "nvda.htm", isXbrl: true, discoveredAt: "2026-10-01T11:00:00Z" });
const markerPath = `company_research_runs/_graph_activation_${tree}`;
const resultFor = (runId: string) => ({ runId, ticker: "NVDA", cik: event.cik, companyName: "NVIDIA",
  extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, edges: [], filing: { ...event, reportDate: null } });
function fixture() {
  const rows = new Map<string, Row>([
    ["company_research_runs/NVDA_latest_10k", { status: "COMPLETED", extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, result: resultFor("legacy") }],
    [`sec_filings/${event.accessionNumber}`, { discoveryPending: false, discoveryEvents: { [event.eventId]: { event, state: "baseline" } } }],
    ["company_fundamentals/NVDA", { secFilingsCollector: { cik: event.cik, lastCompleteAt: event.discoveredAt, scan: null } }],
  ]);
  let clock = now, tail = Promise.resolve();
  const paths: string[] = [], publications: Array<{ type: string; id: string }> = [];
  const ref = (path: string) => ({ path, get: async () => ({ data: () => rows.has(path) ? structuredClone(rows.get(path)) : undefined }) });
  const db = { collection: (name: string) => ({
    doc: (id: string) => { paths.push(`${name}/${id}`); return ref(`${name}/${id}`); },
    where: (field: string, _op: string, value: unknown) => ({ count: () => ({ get: async () => ({ data: () => ({
      count: [...rows].filter(([key, row]) => key.startsWith(`${name}/`) && row[field] === value).length,
    }) }) }) }),
  }), runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const next = tail.then(async () => {
      const writes: Array<{ path: string; value: Row }> = [];
      const output = await fn({ get: async (r: ReturnType<typeof ref>) => { assert.equal(writes.length, 0); return r.get(); },
        set: (r: ReturnType<typeof ref>, value: Row) => writes.push({ path: r.path, value }) });
      for (const write of writes) rows.set(write.path, { ...rows.get(write.path), ...structuredClone(write.value) });
      return output;
    });
    tail = next.then(() => undefined, () => undefined); return next;
  } } as unknown as Firestore;
  const completeGraph = (request: CompanyGraphRequest) => {
    const marker = rows.get(markerPath)!;
    const runId = String(marker.runId);
    rows.set(`company_research_runs/_graph_run_${runId}`, { completed: true, providerResponseId: "resp_canary", result: resultFor(runId) });
    rows.set(`company_research_runs/_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`,
      { requestKey: runId, status: "settled", responseId: "resp_canary", spentMicros: 100, reservedMicros: 400000 });
    rows.set("company_research_requests/NVDA", { ...rows.get("company_research_requests/NVDA"), requestId: request.requestId, status: "COMPLETED" });
  };
  const completeFiling = (runId = String(rows.get(markerPath)!.runId)) => {
    rows.set("company_fundamentals/NVDA", { ...rows.get("company_fundamentals/NVDA"), outcome: "ready",
      lastFilingRefresh: { eventId: event.eventId, accessionNumber: event.accessionNumber } });
    rows.set(`company_research_runs/_graph_filing_receipt_${event.eventId}`, { completed: true,
      eventId: event.eventId, companyId: "NVDA", accessionNumber: event.accessionNumber, runId });
  };
  const deps = { now: () => clock, sleep: async (ms: number) => { clock += ms; },
    publishGraph: async (request: CompanyGraphRequest) => { publications.push({ type: "graph", id: request.requestId }); completeGraph(request); },
    publishFiling: async (filing: typeof event) => { assert.deepEqual(filing, event); publications.push({ type: "filing", id: filing.eventId }); completeFiling(); } };
  return { db, rows, paths, publications, deps, completeGraph, completeFiling };
}

test("live mode is explicit, NVDA-only, and cannot be combined with publisher or transport verification", () => {
  assert.equal(parseCompanyGraphPublisherArgs(["--verify-live"], {}).verifyLive, true);
  for (const args of [["--verify-live", "--apply"], ["--verify-live", "--dry-run"], ["--verify-live", "--limit=1"],
    ["--verify-live", "--verify-delivery"], ["--verify-live", "--company=AMD"], ["--verify-live", "--verify-live"]]) {
    assert.throws(() => parseCompanyGraphPublisherArgs(args, {}));
  }
  assert.throws(() => parseCompanyGraphPublisherArgs(["--verify-live"], { COMPANY_GRAPH_VERIFY_ONLY: "1" }));
});
test("canary commits its exact source once, verifies budget/provider completion, then publishes only the saved filing", async () => {
  const f = fixture(), baseline = structuredClone(f.rows.get(`sec_filings/${event.accessionNumber}`));
  const counts: Row[] = [];
  const result = await verifyLiveCompanyGraph(f.db, tree, { ...f.deps, onPreflight: row => counts.push(row) });
  assert.equal(result.verified, true); assert.equal(result.alreadyVerified, false);
  assert.deepEqual(f.publications.map(p => p.type), ["graph", "filing"]);
  assert.equal(counts[0].pubsubBacklog, "not-inspected"); assert.equal(counts[0].pendingFilingDocuments, 0);
  const marker = f.rows.get(markerPath)!;
  assert.ok(marker.graphVerifiedAt); assert.ok(marker.verifiedAt);
  const request = marker.request as CompanyGraphRequest;
  const source = f.rows.get(`company_research_runs/_graph_source_${request.requestId}`)!;
  assert.equal((source.filing as Row).accessionNumber, event.accessionNumber);
  assert.deepEqual(f.rows.get(`sec_filings/${event.accessionNumber}`), baseline);
  assert.ok(f.paths.every(path => /^(company_research_runs|company_research_requests|company_fundamentals|sec_filings)\//.test(path)));
  assert.equal((await verifyLiveCompanyGraph(f.db, tree, f.deps)).alreadyVerified, true);
  assert.equal(f.publications.length, 2);
});
test("lost graph publish response resumes the saved completed generation without another forced request", async () => {
  const f = fixture();
  await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishGraph: async request => {
    await f.deps.publishGraph(request); throw Error("lost publish response");
  } }), /lost publish/);
  const first = structuredClone(f.rows.get(markerPath));
  await verifyLiveCompanyGraph(f.db, tree, f.deps);
  assert.equal(f.publications.filter(p => p.type === "graph").length, 1);
  assert.deepEqual(f.rows.get(markerPath)?.request, first?.request);
});
test("uncertain filing publication reuses its original event and never repeats completed provider work", async () => {
  const f = fixture();
  await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishFiling: async filing => {
    await f.deps.publishFiling(filing); throw Error("lost filing response");
  } }), /lost filing/);
  await verifyLiveCompanyGraph(f.db, tree, f.deps);
  assert.deepEqual(f.publications.map(p => p.type), ["graph", "filing"]);
});
test("timeout preserves the request and retry republishes only that identity", async () => {
  const f = fixture(), requestIds: string[] = [];
  await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps,
    publishGraph: async request => { requestIds.push(request.requestId); } }), /timed out/);
  await verifyLiveCompanyGraph(f.db, tree, { ...f.deps,
    publishGraph: async request => { requestIds.push(request.requestId); await f.deps.publishGraph(request); } });
  assert.equal(requestIds.length, 2); assert.equal(requestIds[0], requestIds[1]);
  assert.equal((f.rows.get(markerPath)!.request as CompanyGraphRequest).generation, 1);
});
test("activation does not overwrite unfinished work or an unavailable/changed budget", async () => {
  for (const limitMicros of [0, 4_000_000, 6_000_000]) {
    const f = fixture(); f.rows.set("company_research_runs/_graph_daily_budget", { day: "2026-10-01", limitMicros, spentMicros: 0, reservedMicros: 0 });
    await assert.rejects(verifyLiveCompanyGraph(f.db, tree, f.deps), /US\$5/);
    assert.equal(f.rows.has(markerPath), false); assert.equal(f.publications.length, 0);
  }
  for (const status of ["QUEUED", "PROCESSING", "FAILED"]) {
    const f = fixture(); f.rows.set("company_research_requests/NVDA", { status });
    await assert.rejects(verifyLiveCompanyGraph(f.db, tree, f.deps), /unfinished graph work/);
    assert.equal(f.rows.has(markerPath), false); assert.equal(f.publications.length, 0);
  }
});
test("initial activation requires an exact completed baseline and matching cached 10-K", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.rows.delete(`sec_filings/${event.accessionNumber}`),
    (f: ReturnType<typeof fixture>) => f.rows.set(`sec_filings/${event.accessionNumber}`, { discoveryEvents: { [event.eventId]: { event, state: "published" } } }),
    (f: ReturnType<typeof fixture>) => f.rows.delete("company_fundamentals/NVDA"),
    (f: ReturnType<typeof fixture>) => f.rows.set("company_research_runs/NVDA_latest_10k", { status: "FAILED" }),
  ]) {
    const f = fixture(); change(f); await assert.rejects(verifyLiveCompanyGraph(f.db, tree, f.deps));
    assert.equal(f.rows.has(markerPath), false); assert.equal(f.publications.length, 0);
  }
});
test("completed request is insufficient without its exact settled provider reservation", async () => {
  for (const changed of [{ status: "reserved" }, { responseId: "resp_wrong" }, { spentMicros: 999999 }, { requestKey: "wrong" }]) {
    const f = fixture(); await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishGraph: async request => {
      await f.deps.publishGraph(request);
      const key = [...f.rows.keys()].find(path => path.includes("_graph_budget_request_"))!;
      f.rows.set(key, { ...f.rows.get(key), ...changed });
    } }), /settled budget evidence/);
    assert.equal(f.publications.some(p => p.type === "filing"), false);
  }
});
test("a response-less failed provider attempt is retained without another publication", async () => {
  const f = fixture();
  await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishGraph: async request => {
    f.completeGraph(request);
    const key = [...f.rows.keys()].find(path => path.includes("_graph_budget_request_"))!;
    f.rows.set(key, { ...f.rows.get(key), status: "reserved", responseId: null });
    f.rows.set("company_research_requests/NVDA", { ...f.rows.get("company_research_requests/NVDA"), status: "FAILED" });
  } }), /ambiguous/);
  await assert.rejects(verifyLiveCompanyGraph(f.db, tree, f.deps), /ambiguous/);
  assert.equal(f.publications.length, 0);
});
test("a previously completed same-filing run can provide the terminal graph receipt", async () => {
  const f = fixture(), earlierRun = `graph_${"b".repeat(64)}`;
  f.rows.set(`company_research_runs/_graph_run_${earlierRun}`, { completed: true, result: resultFor(earlierRun) });
  const result = await verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishFiling: async () => f.completeFiling(earlierRun) });
  assert.equal(result.verified, true); assert.notEqual(result.runId, earlierRun);
});
test("both exact filing receipts are required, and incomplete fan-out stops after eighteen minutes", async () => {
  for (const breakReceipt of ["fundamentals", "graph", "checkpoint"]) {
    const f = fixture();
    await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishFiling: async () => {
      f.completeFiling();
      if (breakReceipt === "fundamentals") f.rows.set("company_fundamentals/NVDA", { outcome: "ready" });
      if (breakReceipt === "graph") f.rows.delete(`company_research_runs/_graph_filing_receipt_${event.eventId}`);
      if (breakReceipt === "checkpoint") f.rows.delete(`company_research_runs/_graph_run_${f.rows.get(markerPath)!.runId}`);
    } }), /timed out/);
    assert.equal(f.rows.get(markerPath)?.verifiedAt, undefined);
    assert.equal(f.deps.now() - now, 18 * 60_000);
  }
});

for (const reservation of [undefined, { status: "reserved", responseId: "resp_failed" }, { status: "settled", responseId: "resp_failed" }]) {
  test(`a failed request stops immediately without replay or refund (${reservation?.status ?? "no reservation"})`, async () => {
    const f = fixture();
    let publishes = 0, sleeps = 0;
    const dependencies = { ...f.deps, sleep: async () => { sleeps++; throw Error("must not poll a failed request"); },
      publishGraph: async () => {
        publishes++;
        const marker = f.rows.get(markerPath)!;
        if (reservation) f.rows.set(`company_research_runs/_graph_budget_request_${createHash("sha256").update(String(marker.runId)).digest("hex")}`,
          { ...reservation, reservedMicros: 400000, spentMicros: 200000 });
        f.rows.set("company_research_requests/NVDA", { ...f.rows.get("company_research_requests/NVDA"), status: "FAILED", error: "SEC document request returned HTTP 503" });
      } };
    await assert.rejects(verifyLiveCompanyGraph(f.db, tree, dependencies), /NVDA graph request failed: SEC document request returned HTTP 503/);
    const saved = structuredClone([...f.rows]);
    await assert.rejects(verifyLiveCompanyGraph(f.db, tree, dependencies), /Schedules remain paused/);
    assert.equal(publishes, 1); assert.equal(sleeps, 0); assert.deepEqual([...f.rows], saved);
    assert.equal(f.publications.length, 0); assert.equal(f.rows.get(markerPath)?.verifiedAt, undefined);
  });
}
test("failed-request diagnostics redact provider credentials before throwing", async () => {
  const f = fixture();
  await assert.rejects(verifyLiveCompanyGraph(f.db, tree, { ...f.deps, publishGraph: async () => {
    f.rows.set("company_research_requests/NVDA", { ...f.rows.get("company_research_requests/NVDA"), status: "FAILED",
      error: "Authentication failed: Bearer confidential-token; key sk-proj-privatevalue https://example.test/?api_key=privatevalue" });
  } }), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /NVDA graph request failed/);
    assert.doesNotMatch(error.message, /confidential-token|sk-proj-privatevalue|api_key=privatevalue/); return true;
  });
});
