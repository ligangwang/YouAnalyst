import type { Firestore } from "firebase-admin/firestore";
import { CN_COMPANY_ID } from "../knowledge-graph/cn-companies";
import { digest } from "./pubsub";
import { refreshCnAnnual } from "./cn-annual-worker";
import { CN_WORKER_DOC, refreshCnFundamentals } from "./cn-refresh";
import { createCnRequester, createCnSources } from "./cn-sources";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";

export type CnRequest = { version: 1; type: "cn-fundamentals.refresh.requested"; batchId: string; companyId: string; requestedAt: string };
const ledgerRef = (db: Firestore, id: string) => db.collection("company_fundamentals").doc(`_cn_request_${id}`);
export function parseCnRequest(input: unknown): CnRequest {
  const v = input as Partial<CnRequest> | null;
  if (!v || v.version !== 1 || v.type !== "cn-fundamentals.refresh.requested"
    || typeof v.batchId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.batchId)
    || typeof v.companyId !== "string" || !CN_COMPANY_ID.test(v.companyId)
    || typeof v.requestedAt !== "string" || !Number.isFinite(Date.parse(v.requestedAt))) throw Error("Invalid A-share request");
  return { version: 1, type: v.type, batchId: v.batchId, companyId: v.companyId, requestedAt: v.requestedAt };
}

export async function publishCnRequests(db: Firestore, execution: string, companies: string[], publish: (request: CnRequest) => Promise<unknown>) {
  if (!companies.length) throw Error("No A-share map companies found");
  for (const companyId of new Set(companies)) {
    const request = parseCnRequest({ version: 1, type: "cn-fundamentals.refresh.requested", companyId,
      batchId: digest({ execution, companyId }), requestedAt: new Date().toISOString() });
    const ref = ledgerRef(db, request.batchId);
    const saved = await db.runTransaction(async tx => {
      const existing = (await tx.get(ref)).data();
      if (existing) return parseCnRequest(existing.request);
      tx.create(ref, { request }); return request;
    });
    await publish(saved);
  }
  return { requested: new Set(companies).size, mode: "pubsub" };
}

export async function processCnRequest(input: unknown, db: Firestore, log: MaintenanceLog,
  dependencies: { annual?: typeof refreshCnAnnual; refresh?: typeof refreshCnFundamentals; deadline?: number } = {}) {
  const request = parseCnRequest(input), ref = ledgerRef(db, request.batchId);
  const lease = db.collection("company_fundamentals").doc(CN_WORKER_DOC);
  if (!await acquireMaintenanceLease(lease, log.runId)) throw Error("A-share worker is busy; retry");
  try {
    const ledger = (await ref.get()).data();
    if (!ledger || digest(ledger.request) !== digest(request)) throw Error("Unknown or conflicting A-share request");
    if (ledger.completed) return { completed: 1, duplicate: true };
    const deadline = dependencies.deadline ?? Date.now() + 7 * 60_000;
    const companies = [request.companyId];
    let annual = ledger.annual;
    if (!ledger.annualCompleted) {
      annual = await (dependencies.annual ?? refreshCnAnnual)({ db, log, companies,
        deadline: Math.min(deadline - 120_000, Date.now() + 90_000) });
      if (annual.failed || annual.deferred) throw Error("Annual financials require retry");
      await ref.set({ annualCompleted: true, annual }, { merge: true });
    }
    if (Date.now() >= deadline - 90_000) throw Error("A-share processing budget exhausted");
    const requester = createCnRequester({ context: { runId: log.runId, job: "cn-fundamentals-check" } });
    const result = await (dependencies.refresh ?? refreshCnFundamentals)({ db, log, companies, deadline,
      sources: createCnSources(requester), blockedHosts: requester.blockedHosts });
    const stored = (await db.collection("company_fundamentals").doc(request.companyId).get()).data();
    // A single-company request must not use the full-run tolerated-error threshold.
    // Provider cooldowns and unresolved retries remain unacknowledged.
    const incomplete = result.failed || result.actions.failed || result.actions.skipped || result.shares.failed
      || result.shares.skipped || result.marketCaps.failed || result.sourcesIncomplete
      || (result.shares.deferred && stored?.cnShareStatus?.outcome !== "unavailable");
    await ref.set({ result }, { merge: true });
    if (incomplete) throw Error("A-share sources remain incomplete; retry");
    await ref.set({ completed: true, completedAt: new Date().toISOString() }, { merge: true });
    return { ...result, annual, completed: 1 };
  } finally { await releaseMaintenanceLease(lease, log.runId); }
}
