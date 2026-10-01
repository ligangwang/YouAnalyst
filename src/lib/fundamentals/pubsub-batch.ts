import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { FUNDAMENTALS_COLLECTION, needsShareMetadataUpgrade, validFundamentalsTicker } from "./service";
import { refreshCompanyFundamentals } from "./worker";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import { maintenanceError, type MaintenanceLog } from "../maintenance-log";
import { withSecRequestContext } from "../sec-request";
import { refreshCompanyMarketCaps } from "./market-cap";
import { digest, fundamentalsVersion, MAX_BATCH_COMPANIES, parseFundamentalsRequest,
  type FundamentalsRequest, type FundamentalsUpdate } from "./pubsub";

type Progress = { before: string; completed?: boolean; version?: string; changed?: boolean };
type Ledger = { request: FundamentalsRequest; progress: Record<string, Progress>; publishedEventId?: string; completed?: boolean };
const batchRef = (db: Firestore, id: string) => db.collection(FUNDAMENTALS_COLLECTION).doc(`_batch_${id}`);

// Metadata documents share the existing fundamentals collection, like _worker.
// They never set pending/version/value, so company queries cannot select them.
export async function publishPendingFundamentals(db: Firestore, runId: string,
  publish: (request: FundamentalsRequest) => Promise<unknown>, log: MaintenanceLog) {
  const companyIds: string[] = [];
  let cursor: string | undefined;
  while (companyIds.length < 500) {
    let query = db.collection(FUNDAMENTALS_COLLECTION).where("pending", "==", true).orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      cursor = doc.id;
      const data = doc.data();
      if (validFundamentalsTicker(doc.id) && (Number(data.refreshAfter ?? 0) <= Date.now() || needsShareMetadataUpgrade(data))) companyIds.push(doc.id);
      if (companyIds.length >= 500) break;
    }
    if (page.size < 100) break;
  }
  let batches = 0;
  for (let offset = 0; offset < companyIds.length; offset += MAX_BATCH_COMPANIES) {
    const companies = companyIds.slice(offset, offset + MAX_BATCH_COMPANIES);
    const request: FundamentalsRequest = { version: 1, type: "fundamentals.refresh.requested",
      batchId: digest({ runId, companies }), companyIds: companies,
      requestedAt: new Date().toISOString(), reason: "scheduled_or_manual" };
    const ref = batchRef(db, request.batchId);
    // Persist the request before delivery. A failed publish leaves companies pending
    // for the next publisher run; a confirmed publish can safely be delivered twice.
    const existing = (await ref.get()).data();
    if (!existing) await ref.create({ request, progress: {}, createdAt: request.requestedAt });
    await publish(existing?.request ?? request);
    await ref.set({ dispatchedAt: new Date().toISOString() }, { merge: true });
    batches++;
    log.emit("INFO", "batch_published", { batchId: request.batchId, requested: companies.length });
  }
  return { requested: companyIds.length, batches, mode: "pubsub" };
}

export async function processFundamentalsBatch(input: unknown, db: Firestore, log: MaintenanceLog,
  publish: (event: FundamentalsUpdate) => Promise<unknown>, dependencies: {
    refresh?: typeof refreshCompanyFundamentals; marketCaps?: typeof refreshCompanyMarketCaps; deadline?: number;
  } = {}) {
  const request = parseFundamentalsRequest(input);
  const ref = batchRef(db, request.batchId);
  const worker = db.collection(FUNDAMENTALS_COLLECTION).doc("_worker");
  // Same global lease as direct mode: excludes overlapping revisions and batch runs,
  // preserving existing aggregate SEC throttling during migrations and retries.
  if (!await acquireMaintenanceLease(worker, log.runId)) throw new Error("Fundamentals worker is busy; retry batch");
  try {
    let ledger = (await ref.get()).data() as Ledger | undefined;
    if (ledger && digest(ledger.request) !== digest(request)) throw new Error("Batch ID reused with different contents");
    if (ledger?.completed) {
      // A confirmed publish alone does not prove that the duplicate was delivered.
      // Only probes need this receipt; ordinary redelivery remains a read-only fast path.
      if (request.reason === "verification") await ref.set({ verificationDuplicateRunId: log.runId }, { merge: true });
      return { requested: request.companyIds.length, completed: request.companyIds.length, failed: 0, duplicate: true };
    }
    if (!ledger) {
      ledger = { request, progress: {} };
      await ref.create({ ...ledger, createdAt: new Date().toISOString() });
    }
    const deadline = dependencies.deadline ?? Date.now() + 7 * 60_000;
    const refresh = dependencies.refresh ?? refreshCompanyFundamentals;
    let failed = 0;
    for (const ticker of request.companyIds) {
      if (ledger.progress[ticker]?.completed) continue;
      if (Date.now() > deadline - 90_000) break;
      try {
        const company = db.collection(FUNDAMENTALS_COLLECTION).doc(ticker);
        const stored = (await company.get()).data();
        const filingRefresh = request.filing && stored?.lastFilingRefresh?.eventId !== request.filing.eventId;
        const fresh = stored?.outcome === "ready" && stored?.pending !== true
          && (request.reason === "verification" || (!filingRefresh && Number(stored.refreshAfter) > Date.now() && !needsShareMetadataUpgrade(stored)));
        if (request.reason === "verification" && (!fresh || !stored?.value)) throw new Error("Verification requires an existing cached company");
        if (!fresh && Number((await worker.get()).get("providerRetryAfter") ?? 0) > Date.now()) break;
        if (!ledger.progress[ticker]) {
          ledger.progress[ticker] = { before: fundamentalsVersion(stored?.value) };
          await ref.set({ progress: ledger.progress }, { merge: true });
        }
        if (stored?.pending && Number(stored.refreshAfter) > Date.now() && !needsShareMetadataUpgrade(stored)
          && (!filingRefresh || stored.outcome === "retry")) continue;
        if (!fresh) await withSecRequestContext({ ticker, runId: log.runId, job: "refresh-sec-fundamentals" }, () => refresh(ticker, { db, log,
          ...(request.filing ? { filing: request.filing } : {}) }));
        const after = (await company.get()).data();
        if (after?.pending || !["ready", "unavailable"].includes(after?.outcome)) throw new Error("Company refresh remains incomplete");
        if (request.filing && after?.outcome === "ready" && after.lastFilingRefresh?.eventId !== request.filing.eventId) {
          throw new Error("Filing refresh has not been checkpointed");
        }
        const version = fundamentalsVersion(after?.value);
        ledger.progress[ticker] = { ...ledger.progress[ticker], completed: true, version,
          changed: version !== ledger.progress[ticker].before };
        await ref.set({ progress: ledger.progress }, { merge: true });
        log.emit("INFO", "company_completed", { ticker, batchId: request.batchId });
      } catch (error) {
        failed++;
        const details = maintenanceError(error);
        log.emit("ERROR", "company_failed", { ticker, batchId: request.batchId, error: details,
          ...(request.filing ? { filingEventId: request.filing.eventId, accessionNumber: request.filing.accessionNumber } : {}) });
        if (Number(details.code) === 403 || Number(details.code) === 429) {
          await worker.set({ providerRetryAfter: Date.now() + 3_600_000 }, { merge: true });
          break;
        }
      }
    }
    const completed = request.companyIds.filter(t => ledger!.progress[t]?.completed);
    const marketCaps = await (dependencies.marketCaps ?? refreshCompanyMarketCaps)(db, log, completed);
    if (marketCaps.failed) throw new Error("Batch market-cap updates need retry");
    const changed = completed.filter(t => ledger!.progress[t].changed);
    if (changed.length) {
      const versions = Object.fromEntries(changed.map(t => [t, ledger!.progress[t].version!]));
      const eventId = digest({ batchId: request.batchId, versions });
      if (eventId !== ledger.publishedEventId) {
        // Durable progress is the outbox. Retry after a publish/checkpoint crash may
        // redeliver the same eventId; downstream subscribers must deduplicate it.
        await publish({ version: 1, type: "fundamentals.updated", eventId, batchId: request.batchId, companyIds: changed, versions });
        await ref.set({ publishedEventId: eventId }, { merge: true });
      }
    }
    const result = { requested: request.companyIds.length, completed: completed.length,
      failed, remaining: request.companyIds.length - completed.length, changed: changed.length };
    await ref.set({ result, updatedAt: new Date().toISOString() }, { merge: true });
    if (result.remaining) {
      log.emit("WARNING", "batch_retry", { ...result, batchId: request.batchId });
      throw new Error(`Batch incomplete: ${result.remaining} companies need retry`);
    }
    await ref.set({ completed: true, completedAt: new Date().toISOString() }, { merge: true });
    return result;
  } finally { await releaseMaintenanceLease(worker, log.runId); }
}

// A bounded deployment probe goes through the real topic, IAM and subscriber.
// Reuses cached companies, so it does not force provider requests or invent
// financial data. This is explicitly invoked, never run during ordinary jobs.
export async function verifyFundamentalsDelivery(db: Firestore, runId: string,
  publish: (request: FundamentalsRequest) => Promise<unknown>, log: MaintenanceLog,
  dependencies: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const page = await db.collection(FUNDAMENTALS_COLLECTION).where("outcome", "==", "ready").limit(100).get();
  const companyIds = page.docs.filter(d => validFundamentalsTicker(d.id) && d.data().pending !== true && d.data().value).slice(0, 2).map(d => d.id);
  if (companyIds.length < 2) throw new Error("Need two cached companies for safe Pub/Sub delivery verification");
  const request: FundamentalsRequest = { version: 1, type: "fundamentals.refresh.requested", batchId: digest({ probe: runId }),
    companyIds, reason: "verification", requestedAt: new Date().toISOString() };
  await publish(request);
  const deadline = now() + 12 * 60_000;
  let duplicatePublished = false;
  let previousDuplicateRunId: unknown;
  while (now() < deadline) {
    const data = (await batchRef(db, request.batchId).get()).data();
    if (data?.completed && !duplicatePublished) {
      // Re-send the same payload to exercise the completed-batch fast path.
      previousDuplicateRunId = data.verificationDuplicateRunId;
      await publish(request);
      duplicatePublished = true;
    } else if (data?.completed && duplicatePublished && data.verificationDuplicateRunId
      && data.verificationDuplicateRunId !== previousDuplicateRunId) {
      log.emit("INFO", "pubsub_delivery_verified", { batchId: request.batchId, ...data.result, duplicateVerified: true });
      return data.result;
    }
    await sleep(10_000);
  }
  throw new Error(`Subscriber did not ${duplicatePublished ? "confirm duplicate delivery for" : "complete"} probe batch ${request.batchId} within 12 minutes`);
}
