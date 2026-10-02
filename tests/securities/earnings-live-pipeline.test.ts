import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { earningsFirestore } from "../helpers/earnings-firestore";
import { captureEarningsDocument } from "../../src/lib/earnings/document";
import { earningsSourceEvent, parseEarningsJob, type EarningsSourceDiscovered } from "../../src/lib/earnings/live-event";
import { claimEarningsSource, discoverEarningsSource, EARNINGS_COLLECTORS, EARNINGS_RECORDS, EARNINGS_SOURCES, persistEarningsCapture, publishEarningsOutbox, readEarningsCapture, type EarningsWork } from "../../src/lib/earnings/live-store";
import { processEarningsJob } from "../../src/lib/earnings/live-worker";
import { collectLiveEarnings, inspectLiveEarnings } from "../../src/lib/earnings/live-collector";
import { createEarningsRequestGate, readBoundedEarningsBody } from "../../src/lib/earnings/live-transport";
import { createSecEarningsObserver, earningsScanWindow } from "../../src/lib/earnings/sec-observer";
import { createSecFilingsSource } from "../../src/lib/sec-filings/source";
import { secBudget } from "../../src/lib/sec-budget";
import { parseEarningsCollectorArgs } from "../../src/lib/earnings/live-cli";
import { type EarningsRecord, type EarningsSource, sourceIdentity } from "../../src/lib/earnings/model";

const root = "tests/fixtures/earnings/cn/", fixture = JSON.parse(readFileSync(root + "longsys-h1-2026.json", "utf8"));
// These compact source excerpts are synthetic transport/storage scaffolding,
// never counted as additional full original-source validation.
const bytes = readFileSync(root + fixture.bodyFile), plan = JSON.parse(readFileSync(root + fixture.planFile, "utf8"));
const source: EarningsSource = fixture.source;
const log = { runId: "earnings-test", emit: () => {} } as unknown as MaintenanceLog;
const options = (fx: ReturnType<typeof earningsFirestore>, raw = bytes) => ({ enabled: true, now: fx.now,
  download: async () => ({ bytes: raw, mediaType: "text/plain" as const }), publish: async () => "message", resolvePlan: () => plan });
const records = (fx: ReturnType<typeof earningsFirestore>) => [...fx.rows].filter(([path, value]) => path.startsWith(EARNINGS_RECORDS + "/") && value.recordType === "revision");
async function enqueue(fx: ReturnType<typeof earningsFirestore>, value = source) {
  const result = await discoverEarningsSource(fx.db, value, "document", fx.now());
  const work = fx.rows.get(`${EARNINGS_SOURCES}/${result.sourceId}`) as unknown as EarningsWork;
  return earningsSourceEvent(result.sourceId, work.generation);
}
test("live earnings contract rejects forged IDs, generations, extra fields and other pipeline events", () => {
  const event = earningsSourceEvent(sourceIdentity(source), 1);
  assert.deepEqual(parseEarningsJob(event), event);
  for (const value of [{ ...event, eventId: "forged" }, { ...event, generation: "1" }, { ...event, url: source.url }, { ...event, type: "sec.filing.discovered" }, { ...event, generation: 0 }]) assert.throws(() => parseEarningsJob(value));
});
test("concurrent discovery and uncertain outbox acknowledgements keep one stable delivery", async () => {
  const fx = earningsFirestore();
  await Promise.all([discoverEarningsSource(fx.db, source, "document", fx.now()), discoverEarningsSource(fx.db, source, "document", fx.now())]);
  const sent: EarningsSourceDiscovered[] = [];
  fx.reject((_path, value) => value.messageId === "accepted");
  await assert.rejects(() => publishEarningsOutbox(fx.db, async event => { sent.push(event); return "accepted"; }), /commit failure/);
  fx.reject(() => false);
  await publishEarningsOutbox(fx.db, async event => { sent.push(event); return "confirmed"; });
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.equal((await publishEarningsOutbox(fx.db, async () => { throw new Error("duplicate publish"); })).published, 0);
});
test("full raw bytes/text survive chunking and corrupt or missing chunks fail closed", async () => {
  const fx = earningsFirestore(), raw = Buffer.concat([bytes, Buffer.from("\n" + randomBytes(500_000).toString("hex"))]);
  const doc = captureEarningsDocument(source, raw, { mediaType: "text/plain", retrievedAt: new Date(fx.now()).toISOString() });
  const id = await persistEarningsCapture(fx.db, doc, raw), restored = await readEarningsCapture(fx.db, id);
  assert.deepEqual(restored.bytes, raw); assert.equal(restored.document.text, doc.text);
  const chunk = [...fx.rows].find(([path]) => path.includes("/chunk_raw_") && path.endsWith("_1"))!; assert.ok(chunk);
  fx.rows.delete(chunk[0]); await assert.rejects(() => readEarningsCapture(fx.db, id), /Missing or corrupt/);
  fx.rows.set(chunk[0], { ...chunk[1], bytes: Buffer.from("changed") }); await assert.rejects(() => readEarningsCapture(fx.db, id), /Missing or corrupt/);
});
test("worker commits provenance and revision once, retains changed-source history, and ignores stale generations", async () => {
  const fx = earningsFirestore(), event = await enqueue(fx);
  let downloads = 0; const original = options(fx), worker = { ...original, download: async () => { downloads++; return original.download(); } };
  assert.equal((await processEarningsJob(event, fx.db, log, worker)).status, "extracted");
  assert.equal((await processEarningsJob(event, fx.db, log, worker)).status, "duplicate");
  assert.equal(downloads, 1); assert.equal(records(fx).length, 1);
  const first = records(fx)[0][1].record as EarningsRecord;
  assert.equal(first.metrics[0].value, fixture.expected.revenue); assert.equal(first.period.type, "half_year");
  const beforeInspection = fx.writes.length, inspection = await inspectLiveEarnings(fx.db);
  assert.equal(inspection.recordSamples[0].kind, "actual"); assert.equal(inspection.recordSamples[0].period.type, "half_year");
  assert.equal(inspection.recordSamples[0].metrics[0].value, fixture.expected.revenue); assert.equal(fx.writes.length, beforeInspection);
  await discoverEarningsSource(fx.db, source, "document", fx.now(), { force: true });
  const next = earningsSourceEvent(event.sourceId, 2);
  await processEarningsJob(next, fx.db, log, options(fx, Buffer.concat([bytes, Buffer.from("\nReviewed source formatting changed")])));
  assert.equal(records(fx).length, 2);
  const head = fx.rows.get(`${EARNINGS_RECORDS}/head_${first.eventId}`)!;
  assert.equal(head.previousRevisionId, first.revisionId); assert.notEqual(head.revisionId, first.revisionId);
  assert.equal((await processEarningsJob(event, fx.db, log, worker)).status, "duplicate");
  assert.equal(downloads, 1);
});
test("completion commit failure releases its lease and retries without a partial normalized record", async () => {
  const fx = earningsFirestore(), event = await enqueue(fx);
  fx.reject((path, value) => path === `${EARNINGS_SOURCES}/${event.sourceId}` && value.status === "extracted");
  await assert.rejects(() => processEarningsJob(event, fx.db, log, options(fx)), /commit failure/);
  const after = fx.rows.get(`${EARNINGS_SOURCES}/${event.sourceId}`)!;
  assert.equal(after.status, "queued"); assert.equal(after.leaseOwner, null); assert.equal(records(fx).length, 0);
  fx.reject(() => false); await processEarningsJob(event, fx.db, log, options(fx)); assert.equal(records(fx).length, 1);
});
test("paused processing, occupied leases and review-required amendments never produce metrics", async () => {
  const fx = earningsFirestore(), event = await enqueue(fx);
  await assert.rejects(() => processEarningsJob(event, fx.db, log, { ...options(fx), enabled: false }), /paused/);
  await claimEarningsSource(fx.db, event, "other", fx.now());
  await assert.rejects(() => processEarningsJob(event, fx.db, log, options(fx)), /busy/);
  assert.equal(records(fx).length, 0);
  const amended = { ...source, documentId: "synthetic-amendment", title: "2026 年半年度报告（更正后）" };
  const amendment = await enqueue(fx, amended);
  const result = await processEarningsJob(amendment, fx.db, log, options(fx));
  assert.equal(result.status, "review_required"); assert.equal(records(fx).length, 0);
});
test("transient source failure has a finite retry budget and preserves diagnostic evidence", async () => {
  const fx = earningsFirestore(), event = await enqueue(fx), worker = { ...options(fx), download: async () => { throw new Error("429 cooldown"); } };
  for (let attempt = 1; attempt < 5; attempt++) await assert.rejects(() => processEarningsJob(event, fx.db, log, worker), /cooldown/);
  assert.equal((await processEarningsJob(event, fx.db, log, worker)).status, "review_required");
  assert.match(String(fx.rows.get(`${EARNINGS_SOURCES}/${event.sourceId}`)?.reason), /retry_budget_exhausted/);
  assert.equal(records(fx).length, 0);
});
test("CN failure retains its checkpoint and successful sources observe the hourly interval", async () => {
  const fx = earningsFirestore(), path = `${EARNINGS_COLLECTORS}/cn_XSHG:688981`;
  fx.rows.set(path, { lastCompleteAt: "2026-09-30T11:00:00Z", lastReconcileAt: "2026-10-02T10:00:00Z" });
  let calls = 0;
  const collect = () => collectLiveEarnings(fx.db, log, { now: fx.now, deadline: fx.now() + 8 * 60_000, publish: async () => "ok",
    discoverCn: async company => { calls++; if (company === "XSHG:688981") throw new Error("truncated pagination"); return []; } });
  const first = await collect(); assert.equal(first.failed, 1); assert.equal(first.companies, 4);
  assert.equal(fx.rows.get(path)?.lastCompleteAt, "2026-09-30T11:00:00Z");
  const second = await collect(); assert.equal(second.skipped, 3); assert.equal(calls, 5);
  const before = fx.writes.length; await inspectLiveEarnings(fx.db); assert.equal(fx.writes.length, before);
});
test("China scan window includes the current Shanghai date after UTC midnight offset", () => {
  const clock = Date.parse("2026-10-02T17:00:00Z");
  assert.equal(earningsScanWindow(undefined, clock, 8).to, "2026-10-03");
  assert.equal(earningsScanWindow(undefined, clock).to, "2026-10-02");
});
test("body limits include streamed bytes even when content-length is absent", async () => {
  await assert.rejects(() => readBoundedEarningsBody(new Response("12345"), 4), /byte limit/);
  assert.equal((await readBoundedEarningsBody(new Response("1234"), 4)).toString(), "1234");
});
test("earnings provider cooldown is durable across requester instances", async () => {
  const fx = earningsFirestore(), gate = createEarningsRequestGate(fx.db, { now: fx.now, sleep: async ms => fx.advance(ms) });
  await gate.beforeRequest({ host: "www.cninfo.com.cn" });
  await gate.onBlocked({ host: "www.cninfo.com.cn", code: 429, retryAfter: "120" });
  const other = createEarningsRequestGate(fx.db, { now: fx.now, sleep: async ms => fx.advance(ms) });
  await assert.rejects(() => other.beforeRequest({ host: "static.cninfo.com.cn" }), /cooldown/);
  fx.advance(120_000); await other.beforeRequest({ host: "static.cninfo.com.cn" });
});
test("SEC sidecar failures never suppress financial parsing and repeated views reuse one response", async () => {
  const fetcher = globalThis.fetch, budget = secBudget.run, errors = console.error;
  let requests = 0, observed = 0;
  const payload = { cik: 2488, filings: { files: [], recent: { form: ["8-K", "10-K"], accessionNumber: ["0000002488-26-000121", "0000002488-26-000122"],
    filingDate: ["2026-08-04", "2026-08-05"], primaryDocument: ["release.htm", "annual.htm"], isXBRL: [0, 1] } } };
  try {
    globalThis.fetch = async () => { requests++; return new Response(JSON.stringify(payload)); };
    secBudget.run = async (_signal, work) => work(() => {}); console.error = () => {};
    const source = createSecFilingsSource("YouAnalyst test", undefined, async (_cik, raw) => { observed++; assert.deepEqual(raw, payload); throw new Error("PERMISSION_DENIED earnings metadata"); });
    assert.equal((await source.submissions("0000002488")).recent[0].form, "10-K");
    assert.equal((await source.submissions("0000002488")).recent.length, 1);
    assert.equal(requests, 1); assert.equal(observed, 2);
  } finally { globalThis.fetch = fetcher; secBudget.run = budget; console.error = errors; }
});
test("SEC raw observer captures only approved issuer earnings candidates, without changing strict events", async () => {
  const fx = earningsFirestore(), observer = createSecEarningsObserver(fx.db, log, { now: fx.now, deadline: fx.now() + 8 * 60_000 });
  const value = { cik: 2488, filings: { files: [], recent: { form: ["8-K", "10-K", "4"], accessionNumber: ["0000002488-26-000121", "0000002488-26-000122", "0000002488-26-000123"],
    filingDate: ["2026-08-04", "2026-08-05", "2026-08-06"], primaryDocument: ["release.htm", "annual.htm", "form4.xml"] } } };
  await observer.observe("0000002488", value, async () => { throw new Error("unexpected archive"); });
  assert.equal(observer.observed.size, 1); assert.equal([...fx.rows.values()].filter(row => row.recordType === "source").length, 1);
  assert.ok(![...fx.rows.keys()].some(path => path.startsWith("sec_filings/")));
});
test("CLI modes make canary explicit and cannot combine reads with collection", () => {
  assert.equal(parseEarningsCollectorArgs([]), "dry-run"); assert.equal(parseEarningsCollectorArgs(["--apply", "--canary"]), "canary");
  for (const args of [["--canary"], ["--apply", "--diagnostics"], ["--apply", "--apply"], ["--all-companies"]]) assert.throws(() => parseEarningsCollectorArgs(args));
});
