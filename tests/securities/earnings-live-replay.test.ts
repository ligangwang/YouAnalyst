import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { parseEarningsCollectorArgs } from "../../src/lib/earnings/live-cli";
import { inspectLiveEarnings } from "../../src/lib/earnings/live-collector";
import { ALIBABA_MARCH_REPLAY, ALIBABA_MARCH_SOURCE, ALIBABA_MARCH_SOURCE_ID, replayAlibabaMarch2026 } from "../../src/lib/earnings/live-replay";
import { EARNINGS_TOPIC, earningsSourceEvent, type EarningsSourceDiscovered } from "../../src/lib/earnings/live-event";
import { discoverEarningsSource, EARNINGS_COLLECTORS, EARNINGS_RECORDS, EARNINGS_SOURCES } from "../../src/lib/earnings/live-store";
import { processEarningsJob } from "../../src/lib/earnings/live-worker";
import { sourceIdentity, type EarningsSource } from "../../src/lib/earnings/model";
import { earningsFirestore } from "../helpers/earnings-firestore";

const revision = "a".repeat(40), oldRevision = "b".repeat(40);
const source: EarningsSource = { ...ALIBABA_MARCH_SOURCE, title: "EX-99.1", form: "6-K", language: "en", publishedAt: null,
  filingDate: "2026-05-13", firstSeenAt: "2026-10-02T10:00:00Z" };
const sourcePath = `${EARNINGS_SOURCES}/${ALIBABA_MARCH_SOURCE_ID}`;
const receiptPath = `${EARNINGS_COLLECTORS}/replay_alibaba_march_2026_${revision}`;
const log = { runId: "bounded-alibaba-replay", emit: () => {} } as unknown as MaintenanceLog;
const html = readFileSync("tests/fixtures/earnings/live-us/alibaba-sec-announcement.html");

async function fixture(status: "skipped" | "review_required" | "queued" = "skipped") {
  const fx = earningsFirestore();
  await discoverEarningsSource(fx.db, source, "document", fx.now());
  if (status !== "queued") fx.rows.set(sourcePath, { ...fx.rows.get(sourcePath)!, status, publishPending: false, attempts: 1,
    processedRevision: oldRevision, reason: "prior_adapter_rejected_heading", nextCheckAtMs: fx.now() + 86_400_000 });
  const events: EarningsSourceDiscovered[] = [];
  let downloads = 0;
  const process = async (event: EarningsSourceDiscovered, bytes = html) => processEarningsJob(event, fx.db, log, {
    enabled: true, now: fx.now, download: async incoming => {
      assert.equal(incoming.url, ALIBABA_MARCH_SOURCE.url); assert.equal(incoming.documentId, ALIBABA_MARCH_SOURCE.documentId);
      downloads++; return { mediaType: "text/html", bytes };
    }, publish: async () => { throw new Error("Exhibit repair must never publish child/unrelated work"); },
  });
  const publish = async (event: EarningsSourceDiscovered) => { events.push(event); await process(event); return `confirmed-${events.length}`; };
  const options = { revision, collectionEnabled: true, topic: EARNINGS_TOPIC, publish, now: fx.now, sleep: async (ms: number) => fx.advance(ms) };
  return { ...fx, events, process, publish, options, downloads: () => downloads };
}
async function withRevision(work: () => Promise<void>) {
  const previous = process.env.GIT_SHA; process.env.GIT_SHA = revision;
  try { await work(); } finally { if (previous === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = previous; }
}

test("fixed Alibaba repair validates quarterly provenance and preserves source history without draining unrelated work", async () => withRevision(async () => {
  const fx = await fixture();
  const previous = structuredClone(fx.rows.get(sourcePath));
  const unrelated = await discoverEarningsSource(fx.db, { ...source, documentId: "another-reviewed-source" }, "document", fx.now());
  const unrelatedBefore = structuredClone(fx.rows.get(`${EARNINGS_SOURCES}/${unrelated.sourceId}`));
  assert.equal(ALIBABA_MARCH_SOURCE_ID, sourceIdentity(source));
  const result = await replayAlibabaMarch2026(fx.db, fx.options);
  assert.equal(result.verified, true); assert.equal(result.status, "extracted"); assert.equal(result.generation, 2);
  if (!result.verified) assert.fail("Expected actual-quarter proof");
  assert.deepEqual(result.period, { start: "2026-01-01", end: "2026-03-31", type: "quarter", fiscalYear: 2026, fiscalQuarter: 4 });
  assert.equal(result.metrics.find(metric => metric.name === "revenue")?.value, 243_380e6);
  assert.equal(result.metrics.find(metric => metric.name === "revenue")?.currency, "CNY");
  assert.equal(fx.downloads(), 1); assert.deepEqual(fx.events, [earningsSourceEvent(ALIBABA_MARCH_SOURCE_ID, 2)]);
  assert.equal(fx.rows.get(sourcePath)?.firstSeenAt, source.firstSeenAt);
  assert.deepEqual(fx.rows.get(receiptPath)?.previousWork, previous);
  assert.deepEqual(fx.rows.get(`${EARNINGS_SOURCES}/${unrelated.sourceId}`), unrelatedBefore);
  assert.equal(fx.rows.get(receiptPath)?.verified, true);
}));

test("repeated or uncertain publication never creates another generation or overwrites the prior snapshot", async () => withRevision(async () => {
  for (const delivered of [false, true]) {
    const fx = await fixture();
    let publications = 0;
    const publish = async (event: EarningsSourceDiscovered) => {
      fx.events.push(event); publications++;
      if (publications === 1) {
        if (delivered) await fx.process(event);
        throw new Error("Pub/Sub acceptance is uncertain");
      }
      await fx.process(event); return "confirmed";
    };
    await assert.rejects(() => replayAlibabaMarch2026(fx.db, { ...fx.options, publish }), /uncertain/);
    const snapshot = structuredClone(fx.rows.get(receiptPath)?.previousWork);
    const result = await replayAlibabaMarch2026(fx.db, { ...fx.options, publish });
    assert.equal(result.verified, true); assert.equal(result.generation, 2);
    assert.equal(fx.downloads(), 1); assert.equal(publications, delivered ? 1 : 2);
    assert.ok(fx.events.every(event => event.eventId === earningsSourceEvent(ALIBABA_MARCH_SOURCE_ID, 2).eventId));
    const again = await replayAlibabaMarch2026(fx.db, { ...fx.options, publish });
    assert.equal(again.verified, true); assert.equal(again.published, 0); assert.equal(again.generation, 2);
    assert.deepEqual(fx.rows.get(receiptPath)?.previousWork, snapshot);
  }
}));

test("an existing queued generation and a valid current extracted receipt are reused without forcing source work", async () => withRevision(async () => {
  const fx = await fixture("queued");
  const result = await replayAlibabaMarch2026(fx.db, fx.options);
  assert.equal(result.verified, true); assert.equal(result.generation, 1); assert.equal(result.reusedGeneration, true);
  fx.rows.delete(receiptPath);
  const count = fx.events.length;
  const complete = await replayAlibabaMarch2026(fx.db, fx.options);
  assert.equal(complete.verified, true); assert.equal(complete.generation, 1); assert.equal(complete.published, 0);
  assert.equal(fx.events.length, count); assert.equal(fx.downloads(), 1);
}));

test("malformed revisions, destinations, disabled collection and forged source metadata fail before replay writes or publication", async () => {
  const sourceChanges = [
    { provider: "issuer_ir" }, { companyId: "US:AMD" }, { issuerId: "sec:0000002488" },
    { documentId: "0001104659-26-060224/other.htm" }, { accession: "0001104659-26-099220" },
    { url: ALIBABA_MARCH_SOURCE.url + "?other=1" }, { form: "6-K/A" }, { correctionOf: "another_event" },
  ];
  for (const changed of sourceChanges) {
    const fx = await fixture();
    fx.rows.set(sourcePath, { ...fx.rows.get(sourcePath)!, source: { ...source, ...changed } });
    const writes = fx.writes.length;
    await assert.rejects(() => replayAlibabaMarch2026(fx.db, fx.options));
    assert.equal(fx.writes.length, writes); assert.equal(fx.events.length, 0);
  }
  for (const changed of [{ revision: "not-a-sha" }, { revision: "" }, { topic: "other-topic" }, { collectionEnabled: false }]) {
    const fx = await fixture(), writes = fx.writes.length;
    await assert.rejects(() => replayAlibabaMarch2026(fx.db, { ...fx.options, ...changed }));
    assert.equal(fx.writes.length, writes); assert.equal(fx.events.length, 0);
  }
  const missing = await fixture(); missing.rows.delete(sourcePath);
  await assert.rejects(() => replayAlibabaMarch2026(missing.db, missing.options), /Invalid existing/);
  assert.equal(missing.events.length, 0);
});

test("stale subscriber results and conflicting durable replay identities never verify or force a second generation", async () => withRevision(async () => {
  const fx = await fixture();
  const stalePublish = async (event: EarningsSourceDiscovered) => {
    process.env.GIT_SHA = oldRevision;
    try { return await fx.publish(event); } finally { process.env.GIT_SHA = revision; }
  };
  await assert.rejects(() => replayAlibabaMarch2026(fx.db, { ...fx.options, publish: stalePublish }), /stale subscriber/);
  await assert.rejects(() => replayAlibabaMarch2026(fx.db, fx.options), /stale subscriber/);
  assert.equal(fx.rows.get(sourcePath)?.generation, 2); assert.equal(fx.downloads(), 1);
  assert.equal(fx.rows.get(receiptPath)?.verified, false);
  fx.rows.delete(receiptPath);
  await assert.rejects(() => replayAlibabaMarch2026(fx.db, fx.options), /different subscriber revision/);
  const conflict = await fixture();
  conflict.rows.set(receiptPath, { recordType: "bounded_replay", operation: ALIBABA_MARCH_REPLAY, sourceId: ALIBABA_MARCH_SOURCE_ID, revision, generation: 999 });
  await assert.rejects(() => replayAlibabaMarch2026(conflict.db, conflict.options), /receipt\/generation mismatch/);
  assert.equal(conflict.events.length, 0);
}));

test("review-required evidence retains raw provenance and is not repeatedly requeued", async () => withRevision(async () => {
  const fx = await fixture("review_required");
  const unsupported = Buffer.from(html.toString().replace("243,380", "not-numeric"));
  const publish = async (event: EarningsSourceDiscovered) => { fx.events.push(event); await fx.process(event, unsupported); return "confirmed"; };
  const result = await replayAlibabaMarch2026(fx.db, { ...fx.options, publish });
  assert.equal(result.verified, false); assert.equal(result.status, "review_required"); assert.ok(result.rawSha256);
  const repeated = await replayAlibabaMarch2026(fx.db, { ...fx.options, publish });
  assert.equal(repeated.verified, false); assert.equal(repeated.generation, result.generation); assert.equal(fx.downloads(), 1);
  assert.equal([...fx.rows.values()].filter(row => row.recordType === "revision").length, 0);
}));

test("raw corruption, forged normalized metrics and wrong fiscal periods cannot pass repaired-source verification", async () => withRevision(async () => {
  for (const corrupt of ["raw", "metric", "period"] as const) {
    const fx = await fixture();
    const publish = async (event: EarningsSourceDiscovered) => {
      await fx.process(event);
      if (corrupt === "raw") {
        const chunk = [...fx.rows].find(([, row]) => row.recordType === "raw_chunk")!;
        fx.rows.set(chunk[0], { ...chunk[1], bytes: Buffer.from("corrupted") });
      } else {
        const row = [...fx.rows].find(([, value]) => value.recordType === "revision")!;
        const saved = row[1] as { record: { metrics: { value: number }[]; period: { type: string } } };
        if (corrupt === "metric") saved.record.metrics[0].value = 1;
        else saved.record.period.type = "annual";
        fx.rows.set(row[0], saved);
      }
      return "confirmed";
    };
    await assert.rejects(() => replayAlibabaMarch2026(fx.db, { ...fx.options, publish }), /corrupt|identity\/provenance mismatch|strict source validation/);
    assert.equal(fx.rows.get(receiptPath)?.verified, false);
  }
}));

test("bounded timeout retains the accepted generation and never republishes unrelated work", async () => {
  const fx = await fixture();
  const publish = async (event: EarningsSourceDiscovered) => { fx.events.push(event); return "accepted-but-pending"; };
  await assert.rejects(() => replayAlibabaMarch2026(fx.db, { ...fx.options, publish }), /timed out/);
  assert.equal(fx.events.length, 1); assert.equal(fx.rows.get(sourcePath)?.generation, 2);
  await assert.rejects(() => replayAlibabaMarch2026(fx.db, { ...fx.options, publish }), /timed out/);
  assert.equal(fx.events.length, 1); assert.equal(fx.rows.get(sourcePath)?.generation, 2);
});

test("Alibaba replay CLI has one fixed scope and executes before provider discovery setup", () => {
  assert.equal(parseEarningsCollectorArgs(["--apply", "--replay-alibaba-march-2026"]), ALIBABA_MARCH_REPLAY);
  for (const args of [["--replay-alibaba-march-2026"], ["--apply", "--replay-alibaba-march-2026", "--source=other"],
    ["--apply", "--replay-alibaba-march-2026", "--url=https://example.com"], ["--apply", "--canary", "--replay-alibaba-march-2026"],
    ["--apply", "--replay-alibaba-march-2026", "--replay-alibaba-march-2026"]]) assert.throws(() => parseEarningsCollectorArgs(args));
  const cli = readFileSync("scripts/collect-earnings.ts", "utf8");
  assert.ok(cli.indexOf("await replayAlibabaMarch2026") < cli.indexOf("createCnEarningsRequester(gate)"));
  assert.equal(EARNINGS_RECORDS, "earnings_records");
});

test("diagnostics returns only filtered current-SHA replay proof without writing or exposing its previous work snapshot", async () => withRevision(async () => {
  const fx = await fixture();
  const result = await replayAlibabaMarch2026(fx.db, fx.options);
  assert.equal(result.verified, true);
  const receipt = fx.rows.get(receiptPath)!;
  fx.rows.set(receiptPath, { ...receipt, secret: "do-not-display", previousWork: { status: "skipped", source: "do-not-display", raw: "do-not-display" },
    period: { ...result.period, private: "do-not-display" }, metrics: result.metrics!.map(metric => ({ ...metric, evidence: "do-not-display" })) });
  const writes = fx.writes.length;
  const inspected = await inspectLiveEarnings(fx.db), proof = inspected.lastAlibabaMarchReplay;
  assert.ok(proof); assert.equal(proof.verified, true); assert.equal(proof.previousStatus, "skipped");
  assert.equal(proof.revision, revision); assert.equal(proof.sourceId, ALIBABA_MARCH_SOURCE_ID); assert.equal(proof.generation, 2);
  assert.deepEqual(Object.keys(proof).sort(), ["verified", "status", "revision", "sourceId", "generation", "revisionId", "rawSha256", "period", "metrics", "completedAt", "previousStatus"].sort());
  assert.doesNotMatch(JSON.stringify(proof), /do-not-display|previousWork|evidence|private/);
  assert.equal(fx.writes.length, writes);
  process.env.GIT_SHA = "c".repeat(40);
  assert.equal((await inspectLiveEarnings(fx.db)).lastAlibabaMarchReplay, null);
  assert.equal(fx.writes.length, writes);
}));
