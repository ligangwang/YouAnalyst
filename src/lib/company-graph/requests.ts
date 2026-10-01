import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "./types";
import { companyGraphRequestId, parseCompanyGraphRequest, type CompanyGraphRequest } from "./pubsub";

export const GRAPH_LEASE_MS = 10 * 60_000;
export type CompanyGraphRequestStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type CompanyGraphRequestDocument = {
  ticker: string; status: CompanyGraphRequestStatus; requestedCount: number;
  firstRequestedAt: string; lastRequestedAt: string; updatedAt: string;
  completedAt: string | null; failedAt: string | null; error: string | null;
  extractionVersion: typeof COMPANY_GRAPH_EXTRACTION_VERSION;
  generation: number; requestId: string; queuedAt: string; force: boolean;
  edgeCount?: number; processingStartedAt?: string | null; processingRunId?: string | null;
  attemptCount?: number; leaseExpiresAtMs?: number; nextAttemptAtMs?: number; dispatchedAt?: string | null;
};
export type CompanyGraphRequestListItem = CompanyGraphRequestDocument & { id: string };
export type CompanyGraphRequestQueueResult = {
  ticker: string; status: "AVAILABLE" | "QUEUED" | "ALREADY_QUEUED"; message: string;
  request?: CompanyGraphRequest;
};
const str = (v: unknown) => typeof v === "string" ? v : null;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;
export function normalizeCompanyGraphTicker(value: string): string {
  const ticker = value.trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) throw new Error("Enter a valid ticker.");
  return ticker;
}
function item(id: string, data: Record<string, unknown>): CompanyGraphRequestListItem {
  const ticker = str(data.ticker) ?? id;
  const generation = Math.max(1, num(data.generation));
  const first = str(data.firstRequestedAt) ?? str(data.updatedAt) ?? new Date(0).toISOString();
  return { id, ticker, status: ["PROCESSING", "COMPLETED", "FAILED"].includes(String(data.status)) ? data.status as CompanyGraphRequestStatus : "QUEUED",
    requestedCount: Math.max(1, num(data.requestedCount)), firstRequestedAt: first,
    lastRequestedAt: str(data.lastRequestedAt) ?? first, updatedAt: str(data.updatedAt) ?? first,
    completedAt: str(data.completedAt), failedAt: str(data.failedAt), error: str(data.error),
    extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, generation,
    requestId: str(data.requestId) ?? companyGraphRequestId(ticker, generation), queuedAt: str(data.queuedAt) ?? first,
    force: data.force === true, edgeCount: num(data.edgeCount), processingStartedAt: str(data.processingStartedAt),
    processingRunId: str(data.processingRunId), attemptCount: num(data.attemptCount),
    dispatchedAt: str(data.dispatchedAt), leaseExpiresAtMs: num(data.leaseExpiresAtMs), nextAttemptAtMs: num(data.nextAttemptAtMs) };
}
export function requestForCompanyGraphItem(value: CompanyGraphRequestListItem): CompanyGraphRequest {
  return parseCompanyGraphRequest({ version: 1, type: "company.graph.extract.requested", batchId: value.requestId,
    requestId: value.requestId, generation: value.generation, ticker: value.ticker, requestedAt: value.queuedAt, force: value.force });
}
export async function hasCurrentCompanyGraph(ticker: string, db = getAdminFirestore()): Promise<boolean> {
  const data = (await db.collection("company_research_runs").doc(`${normalizeCompanyGraphTicker(ticker)}_latest_10k`).get()).data();
  return data?.status === "COMPLETED" && data.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION
    && typeof data.edgeCount === "number" && data.edgeCount >= 0;
}
// This function is deliberately queue-only. The anonymous endpoint cannot publish paid work.
export async function enqueueCompanyGraphRequest(rawTicker: string, options: { force?: boolean; replay?: boolean; db?: Firestore; now?: number } = {}): Promise<CompanyGraphRequestQueueResult> {
  const ticker = normalizeCompanyGraphTicker(rawTicker), db = options.db ?? getAdminFirestore();
  if (!options.force && await hasCurrentCompanyGraph(ticker, db)) return { ticker, status: "AVAILABLE", message: `${ticker} graph is ready.` };
  const ref = db.collection("company_research_requests").doc(ticker);
  const now = new Date(options.now ?? Date.now()).toISOString();
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), data = snapshot.data();
    const current = data ? item(ticker, data) : null;
    const active = current && (["QUEUED", "PROCESSING"].includes(current.status)
      || (current.status === "FAILED" && !(options.replay && options.force)));
    // Failed requests resume checkpoints unless an operator deliberately forces a new generation.
    const generation = active ? current.generation : (current?.generation ?? 0) + 1;
    const requestId = companyGraphRequestId(ticker, generation);
    const next = { ticker, status: active && current.status === "PROCESSING" ? "PROCESSING" : "QUEUED",
      generation, requestId, force: active ? current.force : options.force === true,
      queuedAt: active ? current.queuedAt : now, requestedCount: (current?.requestedCount ?? 0) + 1,
      firstRequestedAt: current?.firstRequestedAt ?? now, lastRequestedAt: now, updatedAt: now,
      completedAt: null, failedAt: null, error: null, extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
      ...(options.replay && current?.status === "FAILED" ? { dispatchedAt: null, nextAttemptAtMs: 0 } : {}),
      ...(!active ? { processingRunId: null, processingStartedAt: null, leaseExpiresAtMs: 0, nextAttemptAtMs: 0, attemptCount: 0, dispatchedAt: null } : {}) };
    tx.set(ref, next, { merge: true });
    return { ticker, status: active ? "ALREADY_QUEUED" as const : "QUEUED" as const,
      message: `${ticker} ${active ? "is already in" : "was added to"} the graph request queue.`,
      request: requestForCompanyGraphItem(item(ticker, next)) };
  });
}
export async function listCompanyGraphRequests(db = getAdminFirestore()): Promise<CompanyGraphRequestListItem[]> {
  const snapshot = await db.collection("company_research_requests").limit(101).get();
  const order = { PROCESSING: 0, QUEUED: 1, FAILED: 2, COMPLETED: 3 };
  return snapshot.docs.filter(doc => !doc.id.startsWith("_")).slice(0, 100).map(doc => item(doc.id, doc.data())).sort((a, b) => order[a.status] - order[b.status] || b.lastRequestedAt.localeCompare(a.lastRequestedAt));
}
export async function listQueuedCompanyGraphRequests(limit: number, db = getAdminFirestore(), now = Date.now(), options: { unpublishedOnly?: boolean; preview?: boolean } = {}) {
  const cursorRef = db.collection("company_research_requests").doc("_graph_dispatcher");
  let cursor = options.unpublishedOnly ? str((await cursorRef.get()).data()?.cursor) : null;
  const candidates: CompanyGraphRequestListItem[] = [];
  const max = Math.max(1, Math.min(25, Math.trunc(limit)));
  // A persisted cursor bounds each scan while ensuring stuck/published records
  // cannot permanently hide later queued requests.
  for (let page = 0; page < 10 && candidates.length < max; page++) {
    let query = db.collection("company_research_requests").where("status", "in", ["QUEUED", "FAILED", "PROCESSING"])
      .orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      cursor = doc.id;
      const row = item(doc.id, doc.data());
      if ((!options.unpublishedOnly || !row.dispatchedAt) && (row.leaseExpiresAtMs ?? 0) <= now && (row.nextAttemptAtMs ?? 0) <= now) candidates.push(row);
      if (candidates.length >= max) break;
    }
    if (snapshot.docs.length < 100 && candidates.length < max) { cursor = null; break; }
  }
  if (options.unpublishedOnly && !options.preview) await cursorRef.set({ cursor }, { merge: true });
  return candidates;
}
export async function claimCompanyGraphRequest(request: CompanyGraphRequest, owner: string, db = getAdminFirestore(), now = Date.now()) {
  const ref = db.collection("company_research_requests").doc(request.ticker);
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data) return "obsolete" as const;
    const current = item(request.ticker, data);
    if (current.requestId !== request.requestId || current.generation !== request.generation) return "obsolete" as const;
    if (current.force !== request.force || current.queuedAt !== request.requestedAt || current.ticker !== request.ticker) throw new Error("Graph request identity reused with different contents");
    if (current.status === "COMPLETED") return "completed" as const;
    if ((current.leaseExpiresAtMs ?? 0) > now) throw new Error("Graph request lease is busy; retry delivery");
    tx.set(ref, { status: "PROCESSING", generation: request.generation, requestId: request.requestId,
      processingRunId: owner, processingStartedAt: new Date(now).toISOString(), leaseExpiresAtMs: now + GRAPH_LEASE_MS,
      attemptCount: (current.attemptCount ?? 0) + 1, error: null, updatedAt: new Date(now).toISOString() }, { merge: true });
    return "claimed" as const;
  });
}
export async function finishCompanyGraphRequest(request: CompanyGraphRequest, owner: string, result: { edgeCount: number } | { error: string }, db = getAdminFirestore(), now = Date.now()) {
  const ref = db.collection("company_research_requests").doc(request.ticker);
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (data?.requestId !== request.requestId || data?.processingRunId !== owner) return false;
    const iso = new Date(now).toISOString();
    tx.set(ref, { status: "error" in result ? "FAILED" : "COMPLETED", updatedAt: iso,
      leaseExpiresAtMs: 0, processingRunId: null,
      ...("error" in result ? { failedAt: iso, error: result.error, nextAttemptAtMs: now + 60_000 }
        : { completedAt: iso, error: null, edgeCount: result.edgeCount, nextAttemptAtMs: 0 }) }, { merge: true });
    return true;
  });
}
