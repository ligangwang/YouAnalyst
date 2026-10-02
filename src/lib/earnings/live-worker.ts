import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../maintenance-log";
import { captureEarningsDocument } from "./document";
import { classifyEarningsTitle, discoverSecExhibits } from "./discovery";
import { extractEarnings, type ExtractionPlan } from "./extract";
import { makeCnEarningsPlan } from "./live-cn";
import { makeUsEarningsPlan } from "./live-us";
import { parseEarningsJob, type EarningsJob, type EarningsDeliveryProbe, type EarningsSourceDiscovered } from "./live-event";
import { claimEarningsSource, completeEarningsSource, discoverEarningsSource, earningsMetadata, EARNINGS_SOURCES, persistEarningsCapture, publishEarningsOutbox, releaseFailedEarningsSource, type EarningsWork } from "./live-store";
import type { EarningsDownload } from "./live-transport";
import type { EarningsSource, RawEarningsDocument } from "./model";

async function requireCanaryDelivery(db: Firestore, event: EarningsSourceDiscovered, now: number) {
  const marker = (await earningsMetadata(db, "last_canary").get()).data();
  if (!/^[a-f0-9]{40}$/.test(process.env.GIT_SHA ?? "") || !marker || marker.revision !== process.env.GIT_SHA || !Number.isFinite(marker.expiresAtMs)
    || marker.expiresAtMs < now || marker.expiresAtMs > now + 12 * 60_000
    || !Array.isArray(marker.allowedDeliveries) || marker.allowedDeliveries.length !== 2) throw new Error("Earnings canary is not ready for this delivery");
  const allowed = marker.allowedDeliveries.map(parseEarningsJob);
  if (allowed.some(job => job.type !== "earnings.source.discovered") || new Set(allowed.map(job => job.batchId)).size !== 2) throw new Error("Invalid canary delivery allowlist");
  const work = (await db.collection(EARNINGS_SOURCES).doc(event.sourceId).get()).data() as EarningsWork | undefined;
  if (allowed.some(job => job.batchId === event.batchId)) {
    if (!work || work.generation !== event.generation || !((work.inputKind === "sec_filing" && work.source.companyId === "US:AMD" && work.maxExhibits === 5 && work.forceChildren)
      || (work.inputKind === "document" && work.source.companyId === "XSHE:301308"))) throw new Error("Canary intake exceeds its reviewed bounds");
    return;
  }
  if (!work || work.generation !== event.generation || work.inputKind !== "document" || work.source.companyId !== "US:AMD"
    || !allowed.some(job => job.batchId === work.parentDeliveryId)) throw new Error("Earnings delivery is outside the canary cohort/generation");
  const children = await db.collection(EARNINGS_SOURCES).where("parentDeliveryId", "==", work.parentDeliveryId).limit(6).get();
  if (children.size > 5) throw new Error("Canary derived-source budget exceeded");
}

export async function processEarningsProbe(db: Firestore, probe: EarningsDeliveryProbe, now = Date.now()) {
  const ref = earningsMetadata(db, probe.batchId);
  return db.runTransaction(async tx => {
    const saved = (await tx.get(ref)).data();
    if (saved?.type !== "earnings.delivery.probe" || saved.createdAt !== probe.createdAt || !Number.isFinite(saved.expiresAtMs) || Number(saved.expiresAtMs) < now) throw new Error("Earnings probe is not authorized or has expired");
    const deliveries = Number(saved.deliveries ?? 0) + 1;
    tx.set(ref, { deliveries, firstDeliveries: 1, duplicateDeliveries: deliveries - 1, lastReceivedAt: new Date(now).toISOString(), subscriberRevision: process.env.GIT_SHA ?? null }, { merge: true });
    return { status: "verified", deliveries, sourceRequests: 0, earningsRecords: 0 };
  });
}
export async function processEarningsJob(job: EarningsJob, db: Firestore, log: MaintenanceLog, options: {
  enabled: boolean; canaryOnly?: boolean; download: (source: EarningsSource) => Promise<EarningsDownload>;
  publish: (event: EarningsSourceDiscovered) => Promise<string>;
  resolvePlan?: (document: RawEarningsDocument) => ExtractionPlan | null; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  if (job.type === "earnings.delivery.probe") return processEarningsProbe(db, job, now());
  if (!options.enabled) throw new Error("Earnings processing is paused; source delivery remains unacknowledged");
  if (options.canaryOnly) await requireCanaryDelivery(db, job, now());
  const work = await claimEarningsSource(db, job, log.runId, now());
  if (!work) return { status: "duplicate", sourceId: job.sourceId, sourceRequests: 0 };
  try {
    if (work.inputKind === "sec_filing") {
      const source: EarningsSource = { ...work.source, documentId: `${work.source.accession}/${work.source.accession}-index.html`,
        url: new URL(`${work.source.accession}-index.html`, work.source.url).href, title: `${work.source.title} filing index` };
      const downloaded = await options.download(source);
      if (downloaded.mediaType !== "text/html") throw new Error("SEC filing index must be HTML");
      const document = captureEarningsDocument(source, downloaded.bytes, { ...downloaded, retrievedAt: new Date(now()).toISOString() });
      const captureId = await persistEarningsCapture(db, document, downloaded.bytes);
      const children = discoverSecExhibits(work.source, new TextDecoder("utf-8", { fatal: true }).decode(downloaded.bytes));
      if (children.length > (work.maxExhibits ?? 20)) return await completeEarningsSource(db, work, log.runId, { status: "review_required", captureId, reason: "SEC exhibit count exceeds reviewed budget" }, now());
      const ids: string[] = [];
      for (const child of children) ids.push((await discoverEarningsSource(db, child, "document", now(), { parentCaptureId: captureId, parentDeliveryId: job.eventId, force: work.forceChildren })).sourceId);
      // Scope publication to this filing; a canary must not drain unrelated work.
      await publishEarningsOutbox(db, options.publish, 20, ids);
      return await completeEarningsSource(db, work, log.runId, { status: children.length ? "expanded" : "skipped", captureId,
        reason: children.length ? "official_exhibits_discovered" : "no_supported_EX99_exhibit" }, now());
    }
    const downloaded = await options.download(work.source);
    const document = captureEarningsDocument(work.source, downloaded.bytes, { ...downloaded, retrievedAt: new Date(now()).toISOString() });
    const plan = options.resolvePlan ? options.resolvePlan(document)
      : work.source.companyId.startsWith("US:") ? makeUsEarningsPlan(document) : makeCnEarningsPlan(document);
    const plausible = plan || classifyEarningsTitle(work.source.title) !== "unknown"
      || /(?:first|second|third|fourth)\s+quarter|quarterly.{0,30}results|financial.{0,30}results/i.test(document.text.slice(0, 12_000));
    if (!plausible) return await completeEarningsSource(db, work, log.runId, { status: "skipped", reason: "exhibit_has_no_supported_earnings_evidence" }, now());
    const captureId = await persistEarningsCapture(db, document, downloaded.bytes);
    // Amendments/correction notices need an explicit, validated predecessor. No
    // heuristic overwrites another release just because issuer/period agree.
    if ((/\/A$/.test(work.source.form ?? "") || /更正|修订|修正|corrected|restated/i.test(work.source.title)) && !work.source.correctionOf) {
      return await completeEarningsSource(db, work, log.runId, { status: "review_required", captureId, reason: "correction_predecessor_requires_review" }, now());
    }
    if (!plan) return await completeEarningsSource(db, work, log.runId, { status: "review_required", captureId, reason: "unsupported_source_format_or_period" }, now());
    const outcome = extractEarnings(document, plan, new Date(now()).toISOString());
    if (outcome.status !== "extracted") return await completeEarningsSource(db, work, log.runId, { status: outcome.status, captureId, reason: outcome.reason }, now());
    return await completeEarningsSource(db, work, log.runId, { status: "extracted", captureId, record: outcome.record }, now());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Earnings source failed";
    if (work.attempts >= 5) return await completeEarningsSource(db, work, log.runId, { status: "review_required", reason: `retry_budget_exhausted: ${message}` }, now());
    await releaseFailedEarningsSource(db, work, log.runId, message, now());
    throw error;
  }
}
