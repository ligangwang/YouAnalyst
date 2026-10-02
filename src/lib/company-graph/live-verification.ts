import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getGraphBudgetSummary, type GraphBudgetSummary } from "./budget";
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
};
const runIdFor = (request: CompanyGraphRequest, event: SecFilingDiscovered) => `graph_${createHash("sha256")
  .update(JSON.stringify([TICKER, event.accessionNumber, COMPANY_GRAPH_EXTRACTION_VERSION, request.requestId])).digest("hex")}`;
const budgetIdFor = (runId: string) => `_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`;
function assertBudget(budget: GraphBudgetSummary) {
  if (budget.limitUsd !== 5 || budget.timezone !== "America/New_York" || budget.blocked
    || budget.spentUsd + budget.reservedUsd > budget.limitUsd) {
    throw new Error("Live activation requires an available US$5/day America/New_York graph budget; no limit was changed");
  }
}
function budgetReport(budget: GraphBudgetSummary) {
  const { limitUsd, spentUsd, reservedUsd, remainingUsd, day, timezone } = budget;
  return { limitUsd, spentUsd, reservedUsd, remainingUsd, day, timezone };
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

/** One NVDA request and one exact historical filing event. Never drains a queue or resets a run. */
export async function verifyLiveCompanyGraph(db: Firestore, tree: string, dependencies: {
  publishGraph: (request: CompanyGraphRequest) => Promise<unknown>;
  publishFiling: (event: SecFilingDiscovered) => Promise<unknown>;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
  onPreflight?: (counts: Record<string, number | string>) => void;
}) {
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error("An exact reviewed source tree is required for live activation");
  const now = dependencies.now ?? Date.now, sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + MAX_DURATION_MS;
  const initialBudget = await getGraphBudgetSummary(db, now());
  assertBudget(initialBudget);
  const [pending, ...counts] = await Promise.all([
    db.collection("sec_filings").where("discoveryPending", "==", true).count().get(),
    ...["QUEUED", "PROCESSING", "FAILED"].map(status =>
      db.collection("company_research_requests").where("status", "==", status).count().get()),
  ]);
  const preflight = { pendingFilingDocuments: pending.data().count, queuedGraphRequests: counts[0].data().count,
    processingGraphRequests: counts[1].data().count, failedGraphRequests: counts[2].data().count,
    pubsubBacklog: "not-inspected" };
  dependencies.onPreflight?.(preflight);
  const saved = await prepareActivation(db, tree, now());
  const result = { verified: true, ticker: TICKER, tree, requestId: saved.request.requestId,
    runId: saved.runId, eventId: saved.event.eventId, accessionNumber: saved.event.accessionNumber, preflight };
  if (saved.verifiedAt) return { ...result, alreadyVerified: true, budget: budgetReport(initialBudget) };
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
    if (queued?.requestId !== saved.request.requestId) throw new Error("Activation request was superseded; no replacement will be created");
    if (queued.status === "FAILED") {
      if (budget?.status === "reserved" && !budget.responseId) {
        throw new Error("NVDA provider outcome is ambiguous; its reservation and request are retained for operator review");
      }
      throw new Error(`NVDA graph request failed: ${redactGraphFailure(queued.error)}. Schedules remain paused; inspect the saved request and budget before retrying.`);
    }
    if (Number(queued.budgetDeferredUntilMs) > now()) throw new Error("NVDA live graph request is budget-deferred; schedules remain paused");
    if (queued.status !== "COMPLETED") return false;
    if (completed?.completed !== true || completed.result?.runId !== saved.runId || completed.result?.ticker !== TICKER
      || completed.result?.filing?.accessionNumber !== saved.event.accessionNumber
      || !completed.providerResponseId || completed.providerResponseId !== budget?.responseId
      || budget?.requestKey !== saved.runId || budget.status !== "settled"
      || !Number.isSafeInteger(budget.spentMicros) || budget.spentMicros < 0
      || !Number.isSafeInteger(budget.reservedMicros) || budget.reservedMicros <= 0 || budget.spentMicros > budget.reservedMicros) {
      throw new Error("Completed NVDA request lacks matching durable provider and settled budget evidence");
    }
    return true;
  };
  if (!saved.graphVerifiedAt) {
    if (!await bounded(graphComplete)) {
      // Re-publication on a retry preserves request identity; subscriber and budget
      // checkpoints prevent starting another paid request after an uncertain POST.
      await bounded(() => dependencies.publishGraph(saved.request));
      while (!await bounded(graphComplete)) await sleep(10_000);
    }
    await bounded(() => checkpoint(db, saved, "graphVerifiedAt", now()));
  }
  assertBudget(await bounded(() => getGraphBudgetSummary(db, now())));
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
  const finalBudget = await bounded(() => getGraphBudgetSummary(db, now()));
  assertBudget(finalBudget);
  await bounded(() => checkpoint(db, saved, "verifiedAt", now(), finalBudget));
  return { ...result, alreadyVerified: false, budget: budgetReport(finalBudget) };
}
