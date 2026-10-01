import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { createSecFilingDiscovered } from "../../src/lib/sec-filings/event";
import { fundamentalsRequestForFiling, parseFundamentalsRequest, type FundamentalsUpdate } from "../../src/lib/fundamentals/pubsub";
import { processFundamentalsBatch } from "../../src/lib/fundamentals/pubsub-batch";
import { refreshCompanyFundamentals } from "../../src/lib/fundamentals/worker";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";

const filing = createSecFilingDiscovered({ companyId: "AMD", cik: "0000002488", accessionNumber: "0000002488-26-000010",
  form: "20-F", filingDate: "2026-10-01", primaryDocument: "annual.htm", isXbrl: true, discoveredAt: "2026-10-01T00:00:00Z" });
type Row = Record<string, unknown>;
function fixture() {
  const before = { report: { cik: filing.cik, accession: "0000002488-25-000010", form: "20-F" },
    metrics: [{ label: "Revenue", value: 100 }], shareAssessment: { version: 4 }, fetchedAt: "2026-09-30T23:00:00Z" };
  const rows = new Map<string, Row>([["company_fundamentals/AMD", {
    version: 1, pending: false, outcome: "ready", refreshAfter: Date.now() + 86400000, value: before }]]);
  const ref = (id: string) => ({ firestore: db, get: async () => ({ data: () => rows.get(id), get: (key: string) => rows.get(id)?.[key] }),
    set: async (data: Row) => { rows.set(id, { ...rows.get(id), ...data }); },
    create: async (data: Row) => { assert.ok(!rows.has(id)); rows.set(id, data); } });
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({ get: (r: ReturnType<typeof ref>) => r.get(),
      set: (r: ReturnType<typeof ref>, data: Row) => r.set(data) }) } as unknown as Firestore;
  const events: FundamentalsUpdate[] = [];
  const log = { runId: "00000000-0000-0000-0000-000000000001", emit: () => {} } as unknown as MaintenanceLog;
  let reads = 0, available = true;
  const readJson = async <T>(url: string): Promise<T> => {
    reads++;
    return (url.includes("submissions") ? { tickers: ["AMD"], filings: { recent: {
      form: [filing.form], accessionNumber: [filing.accessionNumber], filingDate: [filing.filingDate],
      reportDate: ["2025-12-31"], primaryDocument: [filing.primaryDocument] } } } : {
      cik: Number(filing.cik), facts: available ? { "us-gaap": { Revenues: { units: { USD: [
        { val: 200, start: "2025-01-01", end: "2025-12-31", filed: filing.filingDate,
          form: filing.form, accn: filing.accessionNumber } ] } } } } : {} }) as T;
  };
  const refresh: typeof refreshCompanyFundamentals = (ticker, input) => refreshCompanyFundamentals(ticker,
    { ...input!, identify: async () => filing.cik, readJson });
  const dependencies = { refresh, marketCaps: async () => ({ processed: 1, failed: 0 }) };
  return { rows, db, log, before, events, dependencies, reads: () => reads,
    available: (value: boolean) => { available = value; },
    publish: async (event: FundamentalsUpdate) => { events.push(event); },
    request: fundamentalsRequestForFiling(filing) };
}

test("filing events force a fresh TTL refresh, then deduplicate provider work and updates", async () => {
  const f = fixture();
  assert.deepEqual(parseFundamentalsRequest(f.request), f.request);
  assert.throws(() => parseFundamentalsRequest({ ...f.request, companyIds: ["NVDA"] }), /issuer/);
  const result = await processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies);
  assert.equal(result.completed, 1);
  assert.equal(f.reads(), 2);
  assert.equal(f.events.length, 1);
  assert.equal((f.rows.get("company_fundamentals/AMD")!.lastFilingRefresh as Row).eventId, filing.eventId);
  const duplicate = await processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies);
  assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
  assert.equal(f.reads(), 2);
  assert.equal(f.events.length, 1);
});

test("companyfacts lag preserves the previous cache and retries without acknowledging stale data", async () => {
  const f = fixture();
  f.available(false);
  await assert.rejects(processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies), /incomplete/);
  const stored = f.rows.get("company_fundamentals/AMD")!;
  assert.deepEqual(stored.value, f.before);
  assert.equal(stored.pending, true);
  assert.ok(Number(stored.refreshAfter) > Date.now());
  assert.ok(Number(stored.refreshAfter) <= Date.now() + 300000);
  assert.equal(f.events.length, 0);
  await assert.rejects(processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies), /incomplete/);
  assert.equal(f.reads(), 2);
  stored.refreshAfter = 0;
  f.available(true);
  await processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies);
  assert.equal(f.reads(), 4);
  assert.equal(f.events.length, 1);
});

test("filing result publication resumes from the saved outbox without another SEC call", async () => {
  const f = fixture();
  await assert.rejects(processFundamentalsBatch(f.request, f.db, f.log,
    async () => { throw Error("result topic unavailable"); }, f.dependencies), /result topic/);
  assert.equal(f.reads(), 2);
  await processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies);
  assert.equal(f.reads(), 2);
  assert.equal(f.events.length, 1);
});

test("filing requests preserve global SEC provider cooldowns", async () => {
  const f = fixture();
  f.rows.set("company_fundamentals/_worker", { providerRetryAfter: Date.now() + 3600000 });
  await assert.rejects(processFundamentalsBatch(f.request, f.db, f.log, f.publish, f.dependencies), /incomplete/);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.rows.get("company_fundamentals/AMD")!.value, f.before);
});

test("filing refresh cannot complete without an accession checkpoint", async () => {
  const f = fixture();
  const refresh: typeof refreshCompanyFundamentals = async () => null;
  await assert.rejects(processFundamentalsBatch(f.request, f.db, f.log, f.publish,
    { ...f.dependencies, refresh }), /incomplete/);
  assert.equal(f.events.length, 0);
});

test("non-XBRL amendments refresh known data without waiting for nonexistent accession facts", async () => {
  const f = fixture();
  f.available(false);
  const event = createSecFilingDiscovered({ ...filing, accessionNumber: "0000002488-26-000011", form: "20-F/A", isXbrl: false });
  await processFundamentalsBatch(fundamentalsRequestForFiling(event), f.db, f.log, f.publish, f.dependencies);
  assert.equal(f.reads(), 2);
  assert.equal((f.rows.get("company_fundamentals/AMD")!.lastFilingRefresh as Row).accessionNumber, event.accessionNumber);
});

test("late older-period originals do not replace or block the latest annual report", async () => {
  const f = fixture();
  const newerAnnual = "0000002488-26-000009";
  const refresh: typeof refreshCompanyFundamentals = (ticker, input) => refreshCompanyFundamentals(ticker,
    { ...input!, identify: async () => filing.cik, readJson: async <T>(url: string): Promise<T> =>
      (url.includes("submissions") ? { tickers: ["AMD"], filings: { recent: {
        form: ["20-F", "20-F"], accessionNumber: [filing.accessionNumber, newerAnnual],
        filingDate: [filing.filingDate, "2026-03-01"], reportDate: ["2024-12-31", "2025-12-31"],
        primaryDocument: ["late-old-annual.htm", "current-annual.htm"] } } } : {
        cik: Number(filing.cik), facts: { "us-gaap": { Revenues: { units: { USD: [
          { val: 150, start: "2024-01-01", end: "2024-12-31", filed: filing.filingDate, form: "20-F", accn: filing.accessionNumber },
          { val: 200, start: "2025-01-01", end: "2025-12-31", filed: "2026-03-01", form: "20-F", accn: newerAnnual },
        ] } } } } }) as T });
  await processFundamentalsBatch(f.request, f.db, f.log, f.publish, { ...f.dependencies, refresh });
  const value = f.rows.get("company_fundamentals/AMD")!.value as { report: { accession: string }; metrics: { value: number }[] };
  assert.equal(value.report.accession, newerAnnual);
  assert.equal(value.metrics[0].value, 200);
});

test("XBRL amendments without API-eligible facts stay retryable and never claim stale success", async () => {
  const f = fixture();
  const event = createSecFilingDiscovered({ ...filing, form: "20-F/A" });
  f.available(false);
  const request = fundamentalsRequestForFiling(event);
  await assert.rejects(processFundamentalsBatch(request, f.db, f.log, f.publish, f.dependencies), /incomplete/);
  const stored = f.rows.get("company_fundamentals/AMD")!;
  assert.deepEqual(stored.value, f.before);
  assert.equal(stored.lastFilingRefresh, undefined);
  assert.equal((stored.lastError as Row).code, "SEC_FILING_FACTS_UNRESOLVED");
  assert.equal(f.rows.get(`company_fundamentals/_batch_${request.batchId}`)!.completed, undefined);
  assert.deepEqual(f.events, []);
  stored.refreshAfter = 0;
  f.available(true);
  await processFundamentalsBatch(request, f.db, f.log, f.publish, f.dependencies);
  assert.equal(f.rows.get(`company_fundamentals/_batch_${request.batchId}`)!.completed, true);
});
