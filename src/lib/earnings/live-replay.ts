import { setTimeout as delay } from "node:timers/promises";
import type { Firestore } from "firebase-admin/firestore";
import { validateSource } from "./document";
import { extractEarnings } from "./extract";
import { EARNINGS_TOPIC, earningsSourceEvent, type EarningsSourceDiscovered } from "./live-event";
import { earningsMetadata, EARNINGS_RECORDS, EARNINGS_SOURCES, publishEarningsOutbox, readEarningsCapture, type EarningsWork } from "./live-store";
import { makeUsEarningsPlan } from "./live-us";
import { canonicalJson, sourceIdentity, stableId, validTimestamp, type EarningsRecord, type EarningsSource } from "./model";

// One reviewed repair, not a general source/URL replay API. All destinations and
// identity fields are compiled into this release and checked on every read.
export const ALIBABA_MARCH_REPLAY = "replay-alibaba-march-2026";
export const ALIBABA_MARCH_SOURCE = Object.freeze({ provider: "sec", companyId: "US:BABA", issuerId: "sec:0001577552",
  accession: "0001104659-26-060224", documentId: "0001104659-26-060224/tm2614494d1_ex99-1.htm",
  url: "https://www.sec.gov/Archives/edgar/data/1577552/000110465926060224/tm2614494d1_ex99-1.htm" } as const);
export const ALIBABA_MARCH_SOURCE_ID = stableId("earnings_source", [ALIBABA_MARCH_SOURCE.provider, ALIBABA_MARCH_SOURCE.issuerId, ALIBABA_MARCH_SOURCE.documentId]);
type ReplayWork = EarningsWork & { processedRevision?: string; [key: string]: unknown };
function requireSource(source: EarningsSource) {
  validateSource(source);
  if (Object.entries(ALIBABA_MARCH_SOURCE).some(([key, value]) => source[key as keyof EarningsSource] !== value)
    || source.language !== "en" || source.form !== "6-K" || source.correctionOf !== undefined
    || sourceIdentity(source) !== ALIBABA_MARCH_SOURCE_ID) throw new Error("Alibaba replay source identity mismatch");
}
function requireWork(work: ReplayWork | undefined): asserts work is ReplayWork {
  if (!work || work.recordType !== "source" || work.sourceId !== ALIBABA_MARCH_SOURCE_ID || work.inputKind !== "document"
    || !["queued", "processing", "extracted", "review_required", "skipped"].includes(work.status)
    || typeof work.publishPending !== "boolean" || !Number.isSafeInteger(work.attempts) || work.attempts < 0
    || !validTimestamp(work.firstSeenAt) || work.firstSeenAt !== work.source?.firstSeenAt) throw new Error("Invalid existing Alibaba replay source");
  requireSource(work.source);
  earningsSourceEvent(work.sourceId, work.generation);
}
export async function replayAlibabaMarch2026(db: Firestore, options: {
  revision: string; collectionEnabled: boolean; topic: string;
  publish: (event: EarningsSourceDiscovered) => Promise<string>;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}) {
  if (!/^[a-f0-9]{40}$/.test(options.revision)) throw new Error("Alibaba replay requires the current exact GIT_SHA");
  if (options.collectionEnabled !== true || options.topic !== EARNINGS_TOPIC) throw new Error("Alibaba replay requires enabled collection and the exact earnings destination");
  const now = options.now ?? Date.now, sleep = options.sleep ?? (ms => delay(ms));
  const sourceRef = db.collection(EARNINGS_SOURCES).doc(ALIBABA_MARCH_SOURCE_ID);
  const receipt = earningsMetadata(db, `replay_alibaba_march_2026_${options.revision}`);
  // Reserve one generation and its pre-repair snapshot atomically. A lost
  // acknowledgement or fast terminal worker result can never force a second
  // generation on a repeated invocation of this same reviewed release.
  const reserved = await db.runTransaction(async tx => {
    const work = (await tx.get(sourceRef)).data() as ReplayWork | undefined;
    const prior = (await tx.get(receipt)).data();
    requireWork(work);
    if (prior) {
      if (prior.recordType !== "bounded_replay" || prior.operation !== ALIBABA_MARCH_REPLAY || prior.sourceId !== work.sourceId
        || prior.revision !== options.revision || prior.generation !== work.generation) throw new Error("Alibaba replay receipt/generation mismatch; inspect before retrying");
      return { generation: work.generation, reused: true };
    }
    if (work.status === "extracted" && work.processedRevision !== options.revision) throw new Error("Existing Alibaba extraction belongs to a different subscriber revision");
    const requeue = work.status === "skipped" || work.status === "review_required";
    const generation = work.generation + (requeue ? 1 : 0);
    earningsSourceEvent(work.sourceId, generation);
    if (requeue) {
      const queued: ReplayWork = { ...work, generation, status: "queued", publishPending: true, attempts: 0,
        leaseOwner: null, leaseUntilMs: 0, nextCheckAtMs: 0, lastObservedAt: new Date(now()).toISOString() };
      for (const field of ["captureId", "revisionId", "reason", "processedRevision", "checkedAt", "messageId", "publishedAt", "lastError", "lastFailureAt"]) delete queued[field];
      tx.set(sourceRef, queued);
    }
    tx.set(receipt, { recordType: "bounded_replay", operation: ALIBABA_MARCH_REPLAY, revision: options.revision,
      sourceId: work.sourceId, generation, status: requeue ? "queued" : work.status, startedAt: new Date(now()).toISOString(), verified: false, previousWork: work });
    return { generation, reused: !requeue };
  });
  try {
    // No provider discovery and no global outbox query: this exact existing
    // document is the only source this operation can queue or publish.
    const publication = await publishEarningsOutbox(db, event => {
      if (event.sourceId !== ALIBABA_MARCH_SOURCE_ID || event.generation !== reserved.generation) throw new Error("Alibaba replay publication generation mismatch");
      return options.publish(event);
    }, 1, [ALIBABA_MARCH_SOURCE_ID]);
    const deadline = now() + 8 * 60_000;
    while (now() < deadline) {
      const work = (await sourceRef.get()).data() as ReplayWork | undefined;
      requireWork(work);
      if (work.generation !== reserved.generation) throw new Error("Alibaba replay generation changed; inspect without requeueing");
      if (!["queued", "processing"].includes(work.status)) {
        if (work.processedRevision !== options.revision) throw new Error("Alibaba replay outcome is from a stale subscriber revision");
        const restored = work.captureId ? await readEarningsCapture(db, work.captureId) : null;
        if (restored) {
          requireSource(restored.document.source);
          if (restored.document.sourceId !== work.sourceId) throw new Error("Alibaba replay capture source mismatch");
        }
        const common = { operation: ALIBABA_MARCH_REPLAY, revision: options.revision, sourceId: work.sourceId,
          sourceUrl: ALIBABA_MARCH_SOURCE.url, generation: work.generation, published: publication.published,
          reusedGeneration: reserved.reused, completedAt: new Date(now()).toISOString() };
        if (work.status !== "extracted") {
          const result = { ...common, verified: false as const, status: work.status,
            reason: work.reason ?? "Alibaba source did not produce a validated actual-quarter record",
            captureId: work.captureId ?? null, rawSha256: restored?.document.rawSha256 ?? null };
          await receipt.set(result, { merge: true }); return result;
        }
        if (!restored || !work.revisionId) throw new Error("Alibaba replay lacks stored extraction provenance");
        const stored = (await db.collection(EARNINGS_RECORDS).doc(work.revisionId).get()).data();
        const record = stored?.record as EarningsRecord | undefined;
        if (stored?.recordType !== "revision" || stored.captureId !== work.captureId || !record || record.revisionId !== work.revisionId
          || record.sourceId !== work.sourceId || record.companyId !== ALIBABA_MARCH_SOURCE.companyId || record.issuerId !== ALIBABA_MARCH_SOURCE.issuerId
          || record.completeness !== "full" || record.kind !== "actual" || record.period.type !== "quarter"
          || record.period.start !== "2026-01-01" || record.period.end !== "2026-03-31"
          || record.period.fiscalYear !== 2026 || record.period.fiscalQuarter !== 4
          || record.rawSha256 !== restored.document.rawSha256 || record.textSha256 !== restored.document.textSha256) throw new Error("Alibaba replay actual-quarter record identity/provenance mismatch");
        requireSource(record.source);
        const plan = makeUsEarningsPlan(restored.document);
        const verified = plan ? extractEarnings(restored.document, plan, record.extractedAt) : null;
        if (verified?.status !== "extracted" || canonicalJson(verified.record) !== canonicalJson(record)) throw new Error("Alibaba replay record fails current strict source validation");
        const result = { ...common, verified: true as const, status: "extracted" as const, revisionId: record.revisionId,
          captureId: work.captureId, rawSha256: record.rawSha256, textSha256: record.textSha256, period: record.period,
          metrics: record.metrics.map(metric => ({ name: metric.name, kind: metric.kind, scope: metric.scope, value: metric.value, currency: metric.currency })) };
        await receipt.set(result, { merge: true }); return result;
      }
      await sleep(5000);
    }
    throw new Error("Alibaba replay timed out; retain its generation and inspect without forcing another retry");
  } catch (error) {
    await receipt.set({ verified: false, lastError: (error instanceof Error ? error.message : "Alibaba replay failed").slice(0, 1000), failedAt: new Date(now()).toISOString() }, { merge: true });
    throw error;
  }
}

/** Current-release, read-only public financial proof; never returns its prior work snapshot. */
export async function inspectAlibabaMarchReplay(db: Firestore, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) return null;
  const saved = (await earningsMetadata(db, `replay_alibaba_march_2026_${revision}`).get()).data();
  if (!saved || saved.recordType !== "bounded_replay" || saved.operation !== ALIBABA_MARCH_REPLAY || saved.revision !== revision
    || saved.sourceId !== ALIBABA_MARCH_SOURCE_ID || !Number.isSafeInteger(saved.generation) || saved.generation < 1) return null;
  const states = ["queued", "processing", "skipped", "review_required", "extracted"];
  const period = saved.period;
  return { verified: saved.verified === true, status: states.includes(saved.status) ? saved.status : null,
    revision, sourceId: ALIBABA_MARCH_SOURCE_ID, generation: saved.generation,
    revisionId: typeof saved.revisionId === "string" && /^earnings_revision_[a-f0-9]{64}$/.test(saved.revisionId) ? saved.revisionId : null,
    rawSha256: typeof saved.rawSha256 === "string" && /^[a-f0-9]{64}$/.test(saved.rawSha256) ? saved.rawSha256 : null,
    period: period?.type === "quarter" && period.start === "2026-01-01" && period.end === "2026-03-31" && period.fiscalYear === 2026 && period.fiscalQuarter === 4
      ? { type: "quarter", start: "2026-01-01", end: "2026-03-31", fiscalYear: 2026, fiscalQuarter: 4 } : null,
    metrics: Array.isArray(saved.metrics) ? saved.metrics.slice(0, 10).filter(metric => metric && ["revenue", "revenue_yoy", "revenue_qoq"].includes(metric.name)
      && metric.kind === "actual" && metric.scope === "consolidated" && Number.isFinite(metric.value) && [null, "CNY"].includes(metric.currency))
      .map(metric => ({ name: metric.name, kind: "actual", scope: "consolidated", value: metric.value, currency: metric.currency })) : [],
    completedAt: validTimestamp(saved.completedAt) ? saved.completedAt : null,
    previousStatus: states.includes(saved.previousWork?.status) ? saved.previousWork.status : null };
}
