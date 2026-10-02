import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getGraphBudgetSummary, findGraphBudgetTicket, GRAPH_FLEX_PRICE_VERSION, GRAPH_FLEX_RESERVATION_MICROS, type GraphBudgetSummary } from "./budget";
import { companyGraphRequestId, parseCompanyGraphRequest, type CompanyGraphRequest } from "./pubsub";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "./types";
import { redactGraphFailure } from "./inspection";
import { parseSecFilingDiscovered, secFilingEventId, type SecFilingDiscovered } from "../sec-filings/event";

const TICKER = "NVDA", CIK = "0001045810";
const COLLECTION = "company_research_runs";
const MAX_DURATION_MS = 18 * 60_000;
type Activation = {
  version: 1; tree: string; request: CompanyGraphRequest; event: SecFilingDiscovered;
  runId: string; createdAt: string; graphVerifiedAt?: string; verifiedAt?: string;
  recovery?: { requestId: string; runId: string; responseId: string; preparedAt: string;
    releaseTree: string; originalFailure: { error: unknown; failedAt: unknown; attemptCount: unknown } };
};
const runIdFor = (request: CompanyGraphRequest, event: SecFilingDiscovered) => `graph_${createHash("sha256")
  .update(JSON.stringify([TICKER, event.accessionNumber, COMPANY_GRAPH_EXTRACTION_VERSION, request.requestId])).digest("hex")}`;
const budgetIdFor = (runId: string) => `_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`;
function assertBudget(budget: GraphBudgetSummary, newRequest: boolean) {
  if (newRequest && budget.newRequestsPaused) throw new Error("New paid graph requests are paused; resume only an existing admitted response");
  if (budget.limitUsd !== 5 || budget.timezone !== "America/New_York" || (newRequest && budget.blocked)
    || budget.spentUsd + budget.reservedUsd > budget.limitUsd) {
    throw new Error("Live activation requires an available US$5/day America/New_York graph budget; no limit was changed");
  }
}
function budgetReport(budget: GraphBudgetSummary) {
  const { limitUsd, spentUsd, reservedUsd, remainingUsd, day, timezone, newRequestsPaused } = budget;
  return { limitUsd, spentUsd, reservedUsd, remainingUsd, day, timezone, newRequestsPaused };
}

function assertRequestIdentity(value: Record<string, unknown> | undefined, saved: Activation): asserts value is Record<string, unknown> {
  const request = saved.request;
  if (value?.ticker !== TICKER || value.requestId !== request.requestId || value.generation !== request.generation
    || value.force !== request.force || value.queuedAt !== request.requestedAt
    || value.extractionVersion !== COMPANY_GRAPH_EXTRACTION_VERSION) {
    throw new Error("Activation request was superseded or changed; no replacement will be created");
  }
}

/** Recover only an existing admission, atomically retaining its original failure. */
async function prepareRecovery(db: Firestore, sourceTree: string, releaseTree: string, now: number): Promise<Activation> {
  const marker = db.collection(COLLECTION).doc(`_graph_activation_${sourceTree}`);
  return db.runTransaction(async tx => {
    const raw = (await tx.get(marker)).data();
    if (!raw) throw new Error("Original activation marker is missing; recovery cannot create one");
    const saved = readActivation(raw, sourceTree);
    const requestRef = db.collection("company_research_requests").doc(TICKER);
    const [requestDoc, sourceDoc, runDoc, budgetDoc, lockDoc] = await Promise.all([
      tx.get(requestRef), tx.get(db.collection(COLLECTION).doc(`_graph_source_${saved.request.requestId}`)),
      tx.get(db.collection(COLLECTION).doc(`_graph_run_${saved.runId}`)),
      tx.get(db.collection(COLLECTION).doc(budgetIdFor(saved.runId))),
      tx.get(db.collection(COLLECTION).doc(`_graph_lock_${TICKER}`)),
    ]);
    const request = requestDoc.data(), source = sourceDoc.data(), run = runDoc.data(), budget = budgetDoc.data();
    assertRequestIdentity(request, saved);
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${Number(CIK)}/${saved.event.accessionNumber.replace(/-/g, "")}/${saved.event.primaryDocument}`;
    if (source?.company?.ticker !== TICKER || source.company.cik !== CIK
      || typeof source.company.name !== "string" || !source.company.name.trim() || source.createdAt !== saved.createdAt
      || source.filing?.accessionNumber !== saved.event.accessionNumber || source.filing.filingDate !== saved.event.filingDate
      || source.filing.primaryDocument !== saved.event.primaryDocument || source.filing.filingUrl !== filingUrl
      || run?.ticker !== TICKER || run.accessionNumber !== saved.event.accessionNumber
      || run.extractionVersion !== COMPANY_GRAPH_EXTRACTION_VERSION) {
      throw new Error("Original activation source or run is missing or changed; recovery is blocked");
    }
    const responseId = run.providerResponseId;
    if (typeof responseId !== "string" || !/^resp_[A-Za-z0-9_-]+$/.test(responseId)
      || budget?.responseId !== responseId || budget.requestKey !== saved.runId
      || !["reserved", "settled"].includes(budget.status)
      || !Number.isSafeInteger(budget.reservedMicros) || budget.reservedMicros <= 0
      || (run.providerResult && (run.providerResult.responseId !== responseId || budget.status !== "settled"))) {
      throw new Error("Original provider response and budget reservation are missing or ambiguous; recovery is blocked");
    }
    if (saved.recovery && (saved.recovery.requestId !== saved.request.requestId || saved.recovery.runId !== saved.runId
      || saved.recovery.responseId !== responseId)) throw new Error("Saved recovery identity changed; operator review required");
    if (!["FAILED", "QUEUED", "PROCESSING", "COMPLETED"].includes(String(request.status))
      || (!saved.recovery && request.status !== "FAILED" && request.status !== "COMPLETED")) {
      throw new Error("Original activation has other unfinished work; recovery cannot replace it");
    }
    if (request.status !== "FAILED") return saved;
    if (Number(request.leaseExpiresAtMs) > now || request.processingRunId
      || Number(lockDoc.data()?.leaseExpiresAtMs) > now) throw new Error("Original activation is still leased; recovery cannot reset active work");
    const recovery = saved.recovery ?? { requestId: saved.request.requestId, runId: saved.runId, responseId,
      preparedAt: new Date(now).toISOString(), releaseTree,
      originalFailure: { error: request.error ?? null, failedAt: request.failedAt ?? null, attemptCount: request.attemptCount ?? null } };
    tx.set(marker, { recovery }, { merge: true });
    tx.set(requestRef, { status: "QUEUED", updatedAt: new Date(now).toISOString(), error: null, failedAt: null,
      leaseExpiresAtMs: 0, processingRunId: null, processingStartedAt: null, nextAttemptAtMs: 0,
      budgetDeferredUntilMs: 0, dispatchedAt: null, publishLeaseOwner: null, publishLeaseExpiresAtMs: 0 }, { merge: true });
    return { ...saved, recovery };
  });
}
function readActivation(value: unknown, tree: string): Activation {
  const saved = value as Activation;
  const request = parseCompanyGraphRequest(saved?.request), event = parseSecFilingDiscovered(saved?.event);
  if (saved.version !== 1 || saved.tree !== tree || request.ticker !== TICKER || !request.force
    || event.companyId !== TICKER || event.cik !== CIK || event.form !== "10-K"
    || saved.runId !== runIdFor(request, event) || saved.createdAt !== request.requestedAt) {
    throw new Error("Live activation marker has conflicting identity; operator review required");
  }
  return { ...saved, request, event };
}

/** The marker, exact source and forced request commit together, before publication. */
async function prepareActivation(db: Firestore, tree: string, now: number): Promise<Activation> {
  const marker = db.collection(COLLECTION).doc(`_graph_activation_${tree}`);
  return db.runTransaction(async tx => {
    const prior = (await tx.get(marker)).data();
    if (prior) return readActivation(prior, tree);
    const latest = (await tx.get(db.collection(COLLECTION).doc(`${TICKER}_latest_10k`))).data();
    const result = latest?.result;
    if (latest?.status !== "COMPLETED" || latest.extractionVersion !== COMPANY_GRAPH_EXTRACTION_VERSION
      || result?.ticker !== TICKER || result.cik !== CIK || !Array.isArray(result.edges)
      || !/^\d{10}-\d{2}-\d{6}$/.test(result.filing?.accessionNumber ?? "")
      || typeof result.companyName !== "string" || !result.companyName.trim()) {
      throw new Error("Live activation requires the existing completed NVDA 10-K cache");
    }
    const accession = result.filing.accessionNumber;
    const filing = (await tx.get(db.collection("sec_filings").doc(accession))).data();
    const discovery = filing?.discoveryEvents?.[secFilingEventId(TICKER, CIK, accession)];
    const event = parseSecFilingDiscovered(discovery?.event);
    const fundamentals = (await tx.get(db.collection("company_fundamentals").doc(TICKER))).data();
    if (discovery.state !== "baseline" || event.companyId !== TICKER || event.cik !== CIK || event.form !== "10-K"
      || event.accessionNumber !== accession || event.filingDate !== result.filing.filingDate
      || event.primaryDocument !== result.filing.primaryDocument
      || fundamentals?.secFilingsCollector?.cik !== CIK || !fundamentals.secFilingsCollector.lastCompleteAt
      || fundamentals.secFilingsCollector.scan !== null) {
      throw new Error("Live activation requires the exact stored NVDA 10-K from its completed baseline");
    }
    const requestRef = db.collection("company_research_requests").doc(TICKER);
    const current = (await tx.get(requestRef)).data();
    if (current && current.status !== "COMPLETED") throw new Error("NVDA has unfinished graph work; activation cannot replace it");
    const generation = Number(current?.generation ?? 0) + 1;
    const requestId = companyGraphRequestId(TICKER, generation), createdAt = new Date(now).toISOString();
    const request = parseCompanyGraphRequest({ version: 1, type: "company.graph.extract.requested",
      ticker: TICKER, requestId, batchId: requestId, generation, force: true, requestedAt: createdAt });
    const sourceRef = db.collection(COLLECTION).doc(`_graph_source_${requestId}`);
    if ((await tx.get(sourceRef)).data()) throw new Error("Activation source identity already exists; operator review required");
    const activation: Activation = { version: 1, tree, request, event, createdAt, runId: runIdFor(request, event) };
    tx.set(sourceRef, { company: { ticker: TICKER, cik: CIK, name: result.companyName, exchange: null },
      filing: { accessionNumber: accession, filingDate: event.filingDate, reportDate: result.filing.reportDate ?? null,
        primaryDocument: event.primaryDocument,
        filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(CIK)}/${accession.replace(/-/g, "")}/${event.primaryDocument}` }, createdAt });
    tx.set(requestRef, { ticker: TICKER, status: "QUEUED", requestId, generation, force: true, queuedAt: createdAt,
      requestedCount: Number(current?.requestedCount ?? 0) + 1, firstRequestedAt: current?.firstRequestedAt ?? createdAt,
      lastRequestedAt: createdAt, updatedAt: createdAt, completedAt: null, failedAt: null, error: null,
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, processingRunId: null, processingStartedAt: null,
      leaseExpiresAtMs: 0, nextAttemptAtMs: 0, budgetDeferredUntilMs: 0, attemptCount: 0,
      dispatchedAt: null, publishLeaseOwner: null, publishLeaseExpiresAtMs: 0 });
    tx.set(marker, activation);
    return activation;
  });
}

async function checkpoint(db: Firestore, saved: Activation, field: "graphVerifiedAt" | "verifiedAt", now: number,
  budget?: GraphBudgetSummary) {
  const ref = db.collection(COLLECTION).doc(`_graph_activation_${saved.tree}`);
  await db.runTransaction(async tx => {
    const current = readActivation((await tx.get(ref)).data(), saved.tree);
    if (current.runId !== saved.runId) throw new Error("Live activation identity changed");
    tx.set(ref, { [field]: new Date(now).toISOString(), ...(budget ? { budget: budgetReport(budget) } : {}) }, { merge: true });
  });
}

/** One NVDA request and one exact historical filing event. Never drains a queue or replaces a run. */
export async function verifyLiveCompanyGraph(db: Firestore, tree: string, dependencies: {
  publishGraph: (request: CompanyGraphRequest) => Promise<unknown>;
  publishFiling: (event: SecFilingDiscovered) => Promise<unknown>;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
  resumeTree?: string;
  readBudget?: (now: number) => Promise<GraphBudgetSummary>;
  onPreflight?: (counts: Record<string, number | string>) => void;
}) {
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error("An exact reviewed source tree is required for live activation");
  const resumeTree = dependencies.resumeTree;
  if (resumeTree !== undefined && !/^[a-f0-9]{40}$/.test(resumeTree)) throw new Error("An exact original source tree is required for recovery");
  const now = dependencies.now ?? Date.now, sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const readBudget = dependencies.readBudget ?? (time => getGraphBudgetSummary(db, time));
  const deadline = now() + MAX_DURATION_MS;
  const initialBudget = await readBudget(now());
  // A same-tree retry reuses its admitted response. Its own hold or settled cost
  // must not be mistaken for a second request needing another full reservation.
  let alreadyAdmitted = false;
  if (!resumeTree) {
    if (initialBudget.newRequestsPaused) throw new Error("New paid graph requests are paused; resume only an existing admitted response");
    const prior = (await db.collection(COLLECTION).doc(`_graph_activation_${tree}`).get()).data();
    if (prior && initialBudget.blocked) alreadyAdmitted = Boolean(await findGraphBudgetTicket(readActivation(prior, tree).runId, db));
  }
  assertBudget(initialBudget, !resumeTree && !alreadyAdmitted);
  const [pending, ...counts] = await Promise.all([
    db.collection("sec_filings").where("discoveryPending", "==", true).count().get(),
    ...["QUEUED", "PROCESSING", "FAILED"].map(status =>
      db.collection("company_research_requests").where("status", "==", status).count().get()),
  ]);
  const preflight = { pendingFilingDocuments: pending.data().count, queuedGraphRequests: counts[0].data().count,
    processingGraphRequests: counts[1].data().count, failedGraphRequests: counts[2].data().count,
    pubsubBacklog: "not-inspected" };
  dependencies.onPreflight?.(preflight);
  const saved = resumeTree ? await prepareRecovery(db, resumeTree, tree, now()) : await prepareActivation(db, tree, now());
  const result = { verified: true, ticker: TICKER, tree, requestId: saved.request.requestId,
    runId: saved.runId, eventId: saved.event.eventId, accessionNumber: saved.event.accessionNumber, preflight,
    ...(resumeTree ? { recoveredFromTree: resumeTree, schedulesRemainPaused: true } : {}) };
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    if (now() >= deadline) throw new Error("Live activation timed out; resume the same saved request/event, never force a new run");
    return work();
  };
  const graphComplete = async () => {
    const [request, run, reservation] = await Promise.all([
      db.collection("company_research_requests").doc(TICKER).get(),
      db.collection(COLLECTION).doc(`_graph_run_${saved.runId}`).get(),
      db.collection(COLLECTION).doc(budgetIdFor(saved.runId)).get(),
    ]);
    const queued = request.data(), completed = run.data(), budget = reservation.data();
    assertRequestIdentity(queued, saved);
    if (resumeTree && (!completed?.providerResponseId || completed.providerResponseId !== budget?.responseId
      || budget?.requestKey !== saved.runId || (saved.recovery && completed.providerResponseId !== saved.recovery.responseId))) {
      throw new Error("Original provider response or reservation changed before recovery replay; no replacement will be created");
    }
    if (queued.status === "FAILED") {
      if (budget?.status === "reserved" && !budget.responseId) {
        throw new Error("NVDA provider outcome is ambiguous; its reservation and request are retained for operator review");
      }
      throw new Error(`NVDA graph request failed: ${redactGraphFailure(queued.error)}. Schedules remain paused; inspect the saved request and budget before retrying.`);
    }
    if (Number(queued.budgetDeferredUntilMs) > now()) throw new Error("NVDA live graph request is budget-deferred; schedules remain paused");
    if (queued.status !== "COMPLETED") return false;
    if (completed?.completed !== true || completed.result?.runId !== saved.runId || completed.result?.ticker !== TICKER
      || completed.result?.cik !== CIK || completed.result?.extractionVersion !== COMPANY_GRAPH_EXTRACTION_VERSION
      || !Array.isArray(completed.result?.edges)
      || completed.result?.filing?.accessionNumber !== saved.event.accessionNumber
      || completed.result?.filing?.filingDate !== saved.event.filingDate
      || completed.result?.filing?.primaryDocument !== saved.event.primaryDocument
      || !completed.providerResponseId || completed.providerResponseId !== budget?.responseId
      || (saved.recovery && completed.providerResponseId !== saved.recovery.responseId)
      || budget?.requestKey !== saved.runId || budget.status !== "settled"
      || !Number.isSafeInteger(budget.spentMicros) || budget.spentMicros < 0
      || !Number.isSafeInteger(budget.reservedMicros) || budget.reservedMicros <= 0 || budget.spentMicros > budget.reservedMicros) {
      throw new Error("Completed NVDA request lacks matching durable provider and settled budget evidence");
    }
    if (!resumeTree && (budget.priceVersion !== GRAPH_FLEX_PRICE_VERSION || budget.reservedMicros !== GRAPH_FLEX_RESERVATION_MICROS
      || budget.serviceTier !== "flex" || budget.cacheWriteTokens !== 0 || budget.cachedTokens !== 0
      || budget.reasoningMode !== "standard" || budget.promptCacheMode !== "explicit")) {
      throw new Error("Fresh NVDA activation lacks verified Flex pricing and cache-free settlement");
    }
    return true;
  };
  if (!await bounded(graphComplete)) {
    // Re-publication on a retry preserves request identity; subscriber and budget
    // checkpoints prevent starting another paid request after an uncertain POST.
    await bounded(() => dependencies.publishGraph(saved.request));
    while (!await bounded(graphComplete)) await sleep(10_000);
  }
  if (!saved.graphVerifiedAt) await bounded(() => checkpoint(db, saved, "graphVerifiedAt", now()));
  assertBudget(await bounded(() => readBudget(now())), false);
  const fanoutComplete = async () => {
    const [fundamentals, receipt] = await Promise.all([
      db.collection("company_fundamentals").doc(TICKER).get(),
      db.collection(COLLECTION).doc(`_graph_filing_receipt_${saved.event.eventId}`).get(),
    ]);
    const financial = fundamentals.data(), graph = receipt.data();
    if (!(financial?.outcome === "ready" && financial.lastFilingRefresh?.eventId === saved.event.eventId
      && financial.lastFilingRefresh?.accessionNumber === saved.event.accessionNumber
      && graph?.completed === true && graph.eventId === saved.event.eventId && graph.companyId === TICKER
      && graph.accessionNumber === saved.event.accessionNumber && /^graph_[a-f0-9]{64}$/.test(graph.runId ?? ""))) return false;
    // A pre-existing non-forced checkpoint for this exact filing is also valid.
    const completed = (await db.collection(COLLECTION).doc(`_graph_run_${graph.runId}`).get()).data();
    return completed?.completed === true && completed.result?.runId === graph.runId
      && completed.result?.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION
      && completed.result?.ticker === TICKER && completed.result?.cik === CIK
      && completed.result?.filing?.accessionNumber === saved.event.accessionNumber;
  };
  if (!await bounded(fanoutComplete)) {
    await bounded(() => dependencies.publishFiling(saved.event));
    while (!await bounded(fanoutComplete)) await sleep(10_000);
  }
  const finalBudget = await bounded(() => readBudget(now()));
  assertBudget(finalBudget, false);
  if (!saved.verifiedAt) await bounded(() => checkpoint(db, saved, "verifiedAt", now(), finalBudget));
  return { ...result, alreadyVerified: Boolean(saved.verifiedAt), budget: budgetReport(finalBudget) };
}
