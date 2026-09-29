import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { digest } from "./pubsub";
import { checkPrivateValuation } from "./private-valuations";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";

export type PrivateValuationRequest = {
  version: 1; type: "private-valuation.check.requested"; batchId: string;
  companyId: string; requestedAt: string;
};
const eligible = (data: DocumentData | undefined) =>
  data?.listingStatus === "PRIVATE" && (data.inGraph ?? data.aiGraph)?.status === "PUBLISHED";
const ledgerRef = (db: Firestore, id: string) => db.collection("company_fundamentals").doc(`_private_check_${id}`);

export function parsePrivateValuationRequest(input: unknown): PrivateValuationRequest {
  const v = input as Partial<PrivateValuationRequest> | null;
  if (!v || v.version !== 1 || v.type !== "private-valuation.check.requested"
    || typeof v.batchId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.batchId)
    || typeof v.companyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(v.companyId)
    || typeof v.requestedAt !== "string" || !Number.isFinite(Date.parse(v.requestedAt))) {
    throw new Error("Invalid private valuation request");
  }
  return { version: 1, type: v.type, batchId: v.batchId, companyId: v.companyId, requestedAt: v.requestedAt };
}

export async function publishPrivateValuationChecks(db: Firestore, execution: string,
  publish: (request: PrivateValuationRequest) => Promise<unknown>, log: MaintenanceLog) {
  const [current, legacy] = await Promise.all([
    db.collection("companies").where("inGraph.status", "==", "PUBLISHED").get(),
    db.collection("companies").where("aiGraph.status", "==", "PUBLISHED").get(),
  ]);
  const companies = [...new Map([...legacy.docs, ...current.docs].map(d => [d.id, d])).values()]
    .filter(d => eligible(d.data()));
  for (const company of companies) {
    const request = parsePrivateValuationRequest({ version: 1, type: "private-valuation.check.requested",
      batchId: digest({ execution, companyId: company.id }), companyId: company.id, requestedAt: new Date().toISOString() });
    const ref = ledgerRef(db, request.batchId);
    // A Cloud Run task retry uses the same execution ID and original payload.
    const saved = await db.runTransaction(async tx => {
      const existing = (await tx.get(ref)).data();
      if (existing) return parsePrivateValuationRequest(existing.request);
      tx.create(ref, { request, createdAt: request.requestedAt });
      return request;
    });
    await publish(saved);
    log.emit("INFO", "check_published", { batchId: saved.batchId, company: company.id });
  }
  return { requested: companies.length, mode: "pubsub" };
}

export async function processPrivateValuationCheck(input: unknown, db: Firestore, log: MaintenanceLog,
  check = checkPrivateValuation) {
  const request = parsePrivateValuationRequest(input);
  const ref = ledgerRef(db, request.batchId);
  // Share the direct worker's lease during rollout and rollback.
  const lease = db.collection("company_fundamentals").doc("_private_valuation_worker");
  if (!await acquireMaintenanceLease(lease, log.runId)) throw new Error("Private valuation worker is busy; retry");
  try {
    const existing = (await ref.get()).data();
    if (existing && digest(existing.request) !== digest(request)) throw new Error("Request ID reused with different contents");
    if (existing?.completed) return { completed: 1, duplicate: true };
    if (!existing) await ref.create({ request, createdAt: request.requestedAt });
    const company = db.collection("companies").doc(request.companyId);
    const result = eligible((await company.get()).data()) ? await check(request.companyId) : null;
    // Atomically save the check and its checkpoint: an acknowledged duplicate
    // cannot repeat a completed source check. Never publish a reviewed valuation.
    return await db.runTransaction(async tx => {
      const fresh = (await tx.get(company)).data();
      const skipped = !eligible(fresh);
      if (!skipped && !result) throw new Error("Company eligibility changed; retry");
      if (!skipped) tx.update(company, { privateValuationCheck: result });
      const summary = { completed: 1, skipped, status: skipped ? "ineligible" : result!.status };
      tx.set(ref, { completed: true, completedAt: new Date().toISOString(), result: summary }, { merge: true });
      return summary;
    });
  } finally { await releaseMaintenanceLease(lease, log.runId); }
}
