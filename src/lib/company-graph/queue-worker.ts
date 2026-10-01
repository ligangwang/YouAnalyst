import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";
import type { MaintenanceLog } from "../maintenance-log";
import { publishJobMessage } from "../job-pubsub";
import { withSecRequestContext } from "../sec-request";
import { claimCompanyGraphRequest, deferCompanyGraphRequest, finishCompanyGraphRequest, GRAPH_LEASE_MS, listQueuedCompanyGraphRequests,
  requestForCompanyGraphItem } from "./requests";
import { parseCompanyGraphManualJob, parseCompanyGraphFiling, type CompanyGraphJob, type CompanyGraphRequest,
  type CompanyGraphVerification } from "./pubsub";
import { runLatest10KCompanyGraphExtraction } from "./service";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "./types";
import { GraphBudgetExceededError, readCompanyGraphBudgetAvailability } from "./budget";
import { completeCompanyGraphFilingDeferral, deferCompanyGraphFiling, dispatchDeferredCompanyGraphFiling,
  listDeferredCompanyGraphFilings, readCompanyGraphFilingDeferral, recordCompanyGraphFilingReceipt } from "./deferred-work";
import { SEC_FILINGS_TOPIC, type SecFilingDiscovered } from "../sec-filings/event";

export function normalizeCompanyGraphQueueLimit(value: unknown): number {
  const parsed = Number(value ?? process.env.COMPANY_GRAPH_QUEUE_BATCH_SIZE ?? 1);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, Math.trunc(parsed))) : 1;
}
export async function dispatchCompanyGraphRequest(request: CompanyGraphRequest, db: Firestore,
  publish: (request: CompanyGraphRequest) => Promise<unknown>, now = Date.now()) {
  const ref = db.collection("company_research_requests").doc(request.ticker);
  const publishLeaseOwner = randomUUID();
  const reserved = await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data || (data.requestId && data.requestId !== request.requestId) || data.status === "COMPLETED"
      || data.dispatchedAt || Number(data.leaseExpiresAtMs) > now || Number(data.publishLeaseExpiresAtMs) > now
      || Number(data.nextAttemptAtMs) > now) return false;
    tx.set(ref, { requestId: request.requestId, generation: request.generation, queuedAt: request.requestedAt,
      force: request.force, publishLeaseOwner, publishLeaseExpiresAtMs: now + 30_000 }, { merge: true });
    return true;
  });
  if (!reserved) return { status: "PENDING" as const };
  try {
    await publish(request);
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if (data?.requestId === request.requestId && data.publishLeaseOwner === publishLeaseOwner && data.status !== "COMPLETED") tx.set(ref, {
        dispatchedAt: new Date(now).toISOString(), dispatchError: null, publishLeaseOwner: null, publishLeaseExpiresAtMs: 0,
        nextAttemptAtMs: now + GRAPH_LEASE_MS,
      }, { merge: true });
    });
    return { status: "PUBLISHED" as const };
  } catch (error) {
    // Publish acceptance and response delivery can be ambiguous. Keep the same
    // durable request identity for the next bounded publisher sweep.
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if (data?.requestId === request.requestId && data.publishLeaseOwner === publishLeaseOwner && data.status !== "COMPLETED") tx.set(ref, {
        dispatchError: error instanceof Error ? error.message : "Publication failed", publishLeaseOwner: null, publishLeaseExpiresAtMs: 0,
        nextAttemptAtMs: now + 60_000,
      }, { merge: true });
    });
    throw error;
  }
}
export async function publishQueuedCompanyGraphRequests(input: { limit?: number; preview?: boolean } = {},
  dependencies: { db?: Firestore; publish?: (request: CompanyGraphRequest) => Promise<unknown>;
    publishFiling?: (event: SecFilingDiscovered) => Promise<unknown>;
    budgetAvailability?: typeof readCompanyGraphBudgetAvailability; now?: number } = {}) {
  const db = dependencies.db ?? getAdminFirestore(), now = dependencies.now ?? Date.now();
  const limit = normalizeCompanyGraphQueueLimit(input.limit);
  // Read before either cursor can advance. Datastore/pricing failures propagate
  // without publications; a normal exhausted day pauses the publisher cleanly.
  const budget = await (dependencies.budgetAvailability ?? readCompanyGraphBudgetAvailability)(db, now);
  const items: Array<{ ticker: string; requestId: string; source: "manual" | "filing"; status: string; error?: string }> = [];
  if (!budget.available && !input.preview) return { requestedLimit: limit, published: 0, failed: 0,
    mode: "pubsub", status: "budget_deferred", retryAtMs: budget.retryAtMs, items };
  const [manual, filings] = await Promise.all([
    listQueuedCompanyGraphRequests(limit, db, now, { unpublishedOnly: true, preview: input.preview }),
    listDeferredCompanyGraphFilings(limit, db, now, input.preview),
  ]);
  const cursorRef = db.collection("company_research_requests").doc("_graph_dispatcher");
  const firstQueue = (await cursorRef.get()).data()?.nextQueue === "filing" ? "filing" : "manual";
  const manualWork = manual.map(candidate => ({ source: "manual" as const, request: requestForCompanyGraphItem(candidate) }));
  const filingWork = filings.map(candidate => ({ source: "filing" as const, request: candidate.event }));
  const queues = { manual: manualWork, filing: filingWork };
  const candidates: Array<typeof manualWork[number] | typeof filingWork[number]> = [];
  let nextQueue: "manual" | "filing" = firstQueue;
  while (candidates.length < limit && (manualWork.length || filingWork.length)) {
    const otherQueue = nextQueue === "manual" ? "filing" : "manual";
    const candidate = queues[nextQueue].shift() ?? queues[otherQueue].shift();
    if (!candidate) break;
    candidates.push(candidate);
    nextQueue = candidate.source === "manual" ? "filing" : "manual";
  }
  const publish = dependencies.publish ?? (async request => {
    if (!process.env.COMPANY_GRAPH_REQUEST_TOPIC) throw new Error("COMPANY_GRAPH_REQUEST_TOPIC is required");
    return publishJobMessage(process.env.COMPANY_GRAPH_REQUEST_TOPIC, request);
  });
  const publishFiling = dependencies.publishFiling ?? (async event =>
    publishJobMessage(process.env.SEC_FILINGS_TOPIC || SEC_FILINGS_TOPIC, event));
  for (const candidate of candidates) {
    const identity = { ticker: candidate.source === "manual" ? candidate.request.ticker : candidate.request.companyId,
      requestId: candidate.request.batchId, source: candidate.source };
    if (input.preview) { items.push({ ...identity, status: "PREVIEW" }); continue; }
    try {
      const result = candidate.source === "manual"
        ? await dispatchCompanyGraphRequest(candidate.request, db, publish, now)
        : await dispatchDeferredCompanyGraphFiling(candidate.request, db, publishFiling, now);
      items.push({ ...identity, ...result });
    } catch (error) { items.push({ ...identity, status: "FAILED", error: error instanceof Error ? error.message : "Publication failed" }); }
  }
  if (!input.preview && candidates.length) await cursorRef.set({ nextQueue }, { merge: true });
  return { requestedLimit: limit, published: items.filter(i => i.status === "PUBLISHED").length,
    failed: items.filter(i => i.status === "FAILED").length, mode: input.preview ? "preview" : "pubsub", budgetAvailable: budget.available, items };
}
async function processVerification(request: CompanyGraphVerification, db: Firestore, log: MaintenanceLog) {
  const ref = db.collection("company_research_runs").doc(`_graph_verify_${request.batchId}`);
  return db.runTransaction(async tx => {
    const latest = (await tx.get(db.collection("company_research_runs").doc(`${request.ticker}_latest_10k`))).data();
    const prior = (await tx.get(ref)).data();
    if (latest?.status !== "COMPLETED" || latest.extractionVersion !== COMPANY_GRAPH_EXTRACTION_VERSION
      || latest.result?.runId !== request.expectedRunId || latest.result?.ticker !== request.ticker) throw new Error("Verification requires the unchanged completed graph cache");
    if (prior && (prior.expectedRunId !== request.expectedRunId || prior.ticker !== request.ticker)) throw new Error("Verification identity reused");
    tx.set(ref, { ticker: request.ticker, expectedRunId: request.expectedRunId, completed: true,
      receiptRunId: log.runId, deliveryCount: Number(prior?.deliveryCount ?? 0) + 1,
      verifiedAt: new Date().toISOString() }, { merge: true });
    return { status: "verified", duplicate: Boolean(prior?.completed), providerCalls: 0 };
  });
}
export async function processCompanyGraphJob(input: CompanyGraphJob, db: Firestore, log: MaintenanceLog,
  dependencies: { extract?: typeof runLatest10KCompanyGraphExtraction; enabled?: boolean; now?: () => number } = {}) {
  const request = input.type === "sec.filing.discovered" ? parseCompanyGraphFiling(input) : parseCompanyGraphManualJob(input);
  if (request.type === "company.graph.verify.requested") return processVerification(request, db, log);
  if (request.type === "sec.filing.discovered" && request.form !== "10-K") return { status: "ineligible", form: request.form };
  if (!(dependencies.enabled ?? process.env.COMPANY_GRAPH_PROCESSING_ENABLED === "1")) throw new Error("Company graph processing is disabled; retry after operator enables it");
  const manual = request.type === "company.graph.extract.requested" ? request : null;
  const filing = request.type === "sec.filing.discovered" ? request : null;
  const now = dependencies.now ?? Date.now;
  if (manual) {
    const claimed = await claimCompanyGraphRequest(manual, log.runId, db, now());
    if (claimed !== "claimed") return { duplicate: true, status: claimed };
  }
  if (filing) {
    const deferred = await readCompanyGraphFilingDeferral(filing, db, now());
    if (deferred) return { duplicate: true, ...deferred };
  }
  const ticker = manual?.ticker ?? (request as Extract<CompanyGraphJob, { type: "sec.filing.discovered" }>).companyId;
  try {
    const result = await withSecRequestContext({ ticker, runId: log.runId, job: "company-graph-batch" }, () =>
      (dependencies.extract ?? runLatest10KCompanyGraphExtraction)({ ticker, dryRun: false, force: manual?.force ?? false,
        requestId: request.batchId, requestedAt: manual?.requestedAt, requestGeneration: manual?.generation, ...(request.type === "sec.filing.discovered" ? { filing: request } : {}) }, { db }));
    if (manual) await finishCompanyGraphRequest(manual, log.runId, { edgeCount: result.edges.length }, db, now());
    if (filing) {
      await recordCompanyGraphFilingReceipt(filing, result.runId, db, now());
      await completeCompanyGraphFilingDeferral(filing, db, now());
    }
    return { completed: 1, ticker: result.ticker, runId: result.runId, edgeCount: result.edges.length, cached: result.cached };
  } catch (error) {
    if (error instanceof GraphBudgetExceededError) {
      if (manual) await deferCompanyGraphRequest(manual, log.runId, error.retryAtMs, db, now());
      if (filing) await deferCompanyGraphFiling(filing, error.retryAtMs, db, now());
      return { status: "deferred", ticker, retryAtMs: error.retryAtMs };
    }
    if (manual) await finishCompanyGraphRequest(manual, log.runId, { error: error instanceof Error ? error.message : "Extraction failed" }, db, now());
    throw error;
  }
}
// Deliberate legacy/operator fallback. It uses the exact same request and service
// leases/checkpoints as the subscriber instead of a second execution path.
export async function processQueuedCompanyGraphRequests(input: { limit?: number; force?: boolean } = {}) {
  if (input.force) throw new Error("Queue-wide force is unsupported; force an explicit ticker through the extraction endpoint");
  const db = getAdminFirestore(), requestedLimit = normalizeCompanyGraphQueueLimit(input.limit);
  const processingRunId = `company_graph_queue_${randomUUID()}`;
  const candidates = await listQueuedCompanyGraphRequests(requestedLimit, db);
  const items: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const request = requestForCompanyGraphItem(candidate);
    try { items.push(await processCompanyGraphJob(request, db, { runId: processingRunId } as MaintenanceLog, { enabled: true })); }
    catch (error) { items.push({ ticker: candidate.ticker, error: error instanceof Error ? error.message : "Extraction failed" }); }
  }
  return { processingRunId, requestedLimit, items, failedCount: items.filter(item => item.error).length };
}
export async function verifyCompanyGraphDelivery(db: Firestore, publish: (request: CompanyGraphVerification) => Promise<unknown>,
  dependencies: { now?: () => number; sleep?: (ms: number) => Promise<void>; id?: string } = {}) {
  const page = await db.collection("company_research_runs").where("status", "==", "COMPLETED").limit(100).get();
  const latest = page.docs.find(doc => doc.id.endsWith("_latest_10k") && doc.data().extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION && doc.data().result?.runId);
  if (!latest) throw new Error("Need an existing completed graph for no-provider delivery verification");
  const data = latest.data();
  const request: CompanyGraphVerification = { version: 1, type: "company.graph.verify.requested", batchId: `verify_${dependencies.id ?? randomUUID()}`,
    ticker: data.ticker, expectedRunId: data.result.runId };
  const now = dependencies.now ?? Date.now, sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + 12 * 60_000;
  const ref = db.collection("company_research_runs").doc(`_graph_verify_${request.batchId}`);
  await publish(request);
  let firstReceipt: string | undefined;
  while (now() < deadline) {
    const receipt = (await ref.get()).data();
    if (receipt?.completed && !firstReceipt) {
      firstReceipt = receipt.receiptRunId;
      await publish(request);
    } else if (firstReceipt && receipt?.receiptRunId !== firstReceipt && Number(receipt?.deliveryCount) >= 2) {
      return { verified: true, duplicateVerified: true, batchId: request.batchId, ticker: request.ticker, providerCalls: 0 };
    }
    await sleep(10_000);
  }
  throw new Error(`Graph subscriber did not confirm ${firstReceipt ? "duplicate" : "initial"} delivery within 12 minutes`);
}
