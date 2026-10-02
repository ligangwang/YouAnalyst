import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { earningsFirestore } from "../helpers/earnings-firestore";
import { checkEarningsCanary, runEarningsCanary, selectAmdCanarySource, verifyEarningsDelivery } from "../../src/lib/earnings/live-verification";
import { processEarningsJob } from "../../src/lib/earnings/live-worker";
import { discoverEarningsSource, EARNINGS_COLLECTORS, EARNINGS_RECORDS, EARNINGS_SOURCES, type EarningsWork } from "../../src/lib/earnings/live-store";
import { earningsSourceEvent, type EarningsJob } from "../../src/lib/earnings/live-event";
import type { EarningsSource } from "../../src/lib/earnings/model";

const revision = "a".repeat(40), log = { runId: "verification-test", emit: () => {} } as unknown as MaintenanceLog;
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const cn = json("tests/fixtures/earnings/cn/longsys-h1-2026.json"), cnPlan = json("tests/fixtures/earnings/cn/longsys-h1-2026.plan.json");
const amd: EarningsSource = { provider: "sec", companyId: "US:AMD", issuerId: "sec:0000002488", documentId: "0000002488-26-000121/cover.htm",
  url: "https://www.sec.gov/Archives/edgar/data/2488/000000248826000121/cover.htm", title: "AMD 8-K", form: "8-K", accession: "0000002488-26-000121",
  filingDate: "2026-08-04", publishedAt: null, firstSeenAt: "2026-10-02T11:00:00Z", language: "en" };
const amdPlan = json("tests/fixtures/earnings/us/amd-fy2026-q2.plan.json");
amdPlan.metrics = amdPlan.metrics.filter((metric: {scope:string}) => metric.scope === "consolidated");
for (const metric of amdPlan.metrics) delete metric.sourceUrl;
function runtime(fx: ReturnType<typeof earningsFirestore>, canaryOnly = false) {
  let downloads = 0; const delivered: EarningsJob[] = [];
  const download = async (source: EarningsSource) => {
    downloads++;
    if (source.url.endsWith("-index.html")) return { mediaType: "text/html" as const, bytes: Buffer.from('<h1>AMD filing index</h1><table><tr><td>Earnings release</td><td><a href="release.htm">release.htm</a></td><td>EX-99.1</td></tr></table>') };
    if (source.companyId === "US:AMD") return { mediaType: "text/html" as const, bytes: readFileSync("tests/fixtures/earnings/us/amd-fy2026-q2.excerpt.html") };
    return { mediaType: "text/plain" as const, bytes: readFileSync("tests/fixtures/earnings/cn/longsys-h1-2026.excerpt.txt") };
  };
  // Explicitly synthetic transport harness. Actual full sources have separate
  // provenance manifests; no network or additional source-coverage claim here.
  const publish = async (event: EarningsJob): Promise<string> => {
    delivered.push(event);
      await processEarningsJob(event, fx.db, log, { enabled: true, canaryOnly, now: fx.now, download, publish,
      resolvePlan: source => source.source.companyId === "US:AMD" ? amdPlan : cnPlan });
    return `confirmed-${delivered.length}`;
  };
  return { publish, download, delivered, downloads: () => downloads };
}
test("provider-free probe processes first/duplicate deliveries while earnings is disabled", async () => {
  const previous = process.env.GIT_SHA; process.env.GIT_SHA = revision;
  try {
    const fx = earningsFirestore(); let providerCalls = 0;
    const result = await verifyEarningsDelivery(fx.db, async event => {
      await processEarningsJob(event, fx.db, log, { enabled: false, now: fx.now, download: async () => { providerCalls++; throw new Error("unexpected provider"); }, publish: async () => { throw new Error("unexpected source publish"); } });
      return "confirmed";
    }, { revision, now: fx.now, sleep: async ms => fx.advance(ms) });
    assert.equal(result.firstDeliveries, 1); assert.equal(result.duplicateDeliveries, 1); assert.equal(providerCalls, 0);
    assert.ok(![...fx.rows.keys()].some(path => path.startsWith(EARNINGS_RECORDS + "/")));
  } finally { if (previous === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = previous; }
});
test("live canary scopes intake, verifies stored raw proof, and reprocesses children on a new release", async () => {
  const previous = process.env.GIT_SHA; process.env.GIT_SHA = revision;
  try {
    const fx = earningsFirestore(), worker = runtime(fx, true);
    await discoverEarningsSource(fx.db, { ...cn.source, documentId: "unrelated-pending" }, "document", fx.now());
    const unrelated = [...fx.rows].find(([, value]) => value.recordType === "source")!;
    const verify = (commit: string) => runEarningsCanary(fx.db, { revision: commit, now: fx.now, sleep: async ms => fx.advance(ms),
      discover: async () => [amd, cn.source], publish: worker.publish });
    const first = await verify(revision);
    assert.equal(first.verified, true); assert.equal(first.records.length, 2); assert.equal(worker.downloads(), 3);
    assert.equal(fx.rows.get(unrelated[0])?.publishPending, true, "canary must not publish unrelated work");
    assert.equal((await checkEarningsCanary(fx.db, revision, fx.now())).verified, true);
    const nextRevision = "b".repeat(40); process.env.GIT_SHA = nextRevision;
    await verify(nextRevision); assert.equal(worker.downloads(), 6, "new release re-extracts the exhibit rather than trusting its old receipt");
    assert.equal([...fx.rows.values()].filter(value => value.recordType === "revision").length, 2, "unchanged financial content remains idempotent");
    await assert.rejects(() => checkEarningsCanary(fx.db, revision, fx.now()), /fresh verified/);
    assert.equal((await checkEarningsCanary(fx.db, nextRevision, fx.now())).verified, true);
    const chunk = `${EARNINGS_SOURCES}/chunk_raw_${first.records[0].rawSha256}_0`; fx.rows.delete(chunk);
    await assert.rejects(() => checkEarningsCanary(fx.db, nextRevision, fx.now()), /Missing or corrupt/);
  } finally { if (previous === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = previous; }
});
test("failed canary invalidates an earlier marker and never drains other sources", async () => {
  const fx = earningsFirestore(); fx.rows.set(`${EARNINGS_COLLECTORS}/last_canary`, { verified: true, revision });
  let published = 0;
  await assert.rejects(() => runEarningsCanary(fx.db, { revision, now: fx.now, discover: async () => { throw new Error("source blocked"); }, publish: async () => { published++; return "unexpected"; } }), /source blocked/);
  assert.equal(published, 0); assert.equal(fx.rows.get(`${EARNINGS_COLLECTORS}/last_canary`)?.verified, false);
});
test("canary rejects an active normal generation before publishing its larger exhibit budget", async () => {
  const fx = earningsFirestore(); let published = 0;
  const normal = await discoverEarningsSource(fx.db, amd, "sec_filing", fx.now());
  await assert.rejects(() => runEarningsCanary(fx.db, { revision, now: fx.now, discover: async () => [amd, cn.source],
    publish: async () => { published++; return "unexpected"; } }), /outside the bounded canary/);
  assert.equal(published, 0);
  assert.equal(fx.rows.get(`${EARNINGS_SOURCES}/${normal.sourceId}`)?.maxExhibits, 20);
  assert.equal(fx.rows.get(`${EARNINGS_COLLECTORS}/last_canary`)?.verified, false);
});
test("canary worker blocks old non-cohort and same-company unrelated deliveries before download", async () => {
  const previous = process.env.GIT_SHA; process.env.GIT_SHA = revision;
  try {
    const fx = earningsFirestore(), worker = runtime(fx, true);
    await runEarningsCanary(fx.db, { revision, now: fx.now, sleep: async ms => fx.advance(ms), discover: async () => [amd, cn.source], publish: worker.publish });
    const initial = worker.downloads();
    const baba = json("tests/fixtures/earnings/us/baba-fy2027-q1.replay.json").source;
    for (const extra of [baba, { ...cn.source, documentId: "other-longsys-source" }]) {
      const queued = await discoverEarningsSource(fx.db, extra, "document", fx.now());
      await assert.rejects(() => processEarningsJob(earningsSourceEvent(queued.sourceId, 1), fx.db, log,
        { enabled: true, canaryOnly: true, now: fx.now, download: worker.download, publish: worker.publish }), /outside the canary/);
      assert.equal(fx.rows.get(`${EARNINGS_SOURCES}/${queued.sourceId}`)?.attempts, 0);
    }
    assert.equal(worker.downloads(), initial);
  } finally { if (previous === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = previous; }
});
test("canary source selection requires Item2.02 and does not use a later unrelated 8-K", () => {
  const recent = { form: ["8-K", "8-K"], accessionNumber: [amd.accession, "0000002488-26-000199"],
    filingDate: ["2026-08-04", "2026-10-01"], primaryDocument: ["cover.htm", "unrelated.htm"], items: ["2.02,9.01", "5.02,9.01"] };
  assert.equal(selectAmdCanarySource({ cik: 2488, filings: { recent } }, Date.parse("2026-10-02T11:00:00Z")).accession, amd.accession);
  assert.throws(() => selectAmdCanarySource({ cik: 2488, filings: { recent: { ...recent, items: [] } } }), /Item 2.02/);
});
test("parent commit retries do not force a completed child into another generation", async () => {
  const previous = process.env.GIT_SHA; process.env.GIT_SHA = revision;
  try {
    const fx = earningsFirestore(), worker = runtime(fx);
    const parent = await discoverEarningsSource(fx.db, amd, "sec_filing", fx.now(), { force: true, maxExhibits: 5 });
    const event = earningsSourceEvent(parent.sourceId, 1);
    fx.reject((path, value) => path === `${EARNINGS_SOURCES}/${parent.sourceId}` && value.status === "expanded");
    await assert.rejects(() => processEarningsJob(event, fx.db, log, { enabled: true, now: fx.now, download: worker.download, publish: worker.publish }), /commit failure/);
    const child = [...fx.rows.values()].find(value => value.recordType === "source" && (value.source as EarningsSource).url.endsWith("release.htm")) as unknown as EarningsWork;
    assert.equal(child.generation, 1); assert.equal(child.status, "extracted");
    fx.reject(() => false);
    await processEarningsJob(event, fx.db, log, { enabled: true, now: fx.now, download: worker.download, publish: worker.publish });
    assert.equal((fx.rows.get(`${EARNINGS_SOURCES}/${child.sourceId}`) as unknown as EarningsWork).generation, 1);
    assert.equal(worker.downloads(), 3, "only the index is retried; its completed child stays idempotent");
  } finally { if (previous === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = previous; }
});
