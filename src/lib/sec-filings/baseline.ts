import type { Firestore } from "firebase-admin/firestore";
import { isCurrentCompanyGraph } from "../company-graph/requests";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";
import { createSecFilingDiscovered } from "./event";
import type { SecFilingsSource } from "./source";
import { persistSecFilingDiscovery, readSecCollectorCursor, secCollectorMetadata, writeSecCollectorCursor } from "./store";

function validateCompany(companyId: string) {
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(companyId)) throw new Error("One explicit US ticker is required");
}

/** Read-only diagnostics. Counts are ledger documents, not Pub/Sub backlog metrics. */
export async function inspectSecBaseline(db: Firestore, companyId: string) {
  validateCompany(companyId);
  const cursor = await readSecCollectorCursor(db, companyId);
  const [metadata, latest, request, pending, ...counts] = await Promise.all([
    secCollectorMetadata(db).get(),
    db.collection("company_research_runs").doc(`${companyId}_latest_10k`).get(),
    db.collection("company_research_requests").doc(companyId).get(),
    db.collection("sec_filings").where("discoveryPending", "==", true).count().get(),
    ...["QUEUED", "PROCESSING", "FAILED", "COMPLETED"].map(status =>
      db.collection("company_research_requests").where("status", "==", status).count().get()),
  ]);
  const cache = latest.data(), queued = request.data();
  return {
    dryRun: true, mode: "baseline-only", companyId, providerCalls: 0, publication: "disabled",
    baselineState: !cursor ? "new" : cursor.lastCompleteAt !== null ? "already-completed"
      : cursor.scan?.baseline === false ? "ineligible-nonbaseline-scan" : "resume-initial-baseline",
    cursor: cursor ? { cik: cursor.cik, baselineAt: cursor.baselineAt, lastCompleteAt: cursor.lastCompleteAt,
      snapshotFilings: cursor.scan?.baselineFilings?.length ?? null } : null,
    collectorLeaseExpiresAtMs: Number(metadata.get("leaseExpiresAtMs")) || 0,
    pendingFilingDocuments: pending.data().count,
    graphLedgerCounts: Object.fromEntries(["QUEUED", "PROCESSING", "FAILED", "COMPLETED"].map((status, i) => [status, counts[i].data().count])),
    selectedRequestStatus: ["QUEUED", "PROCESSING", "FAILED", "COMPLETED"].includes(queued?.status) ? queued!.status : null,
    selectedRequestPublished: Boolean(queued?.dispatchedAt),
    graphCacheEligible: isCurrentCompanyGraph(cache),
    pubsubBacklog: "not-inspected",
  };
}

/**
 * A deliberately separate path: no publisher, outbox query/drain, archive fetch,
 * graph work or global rotation. Once frozen, only the initial snapshot is used
 * on retries. A completed cursor is never reset or advanced by this mode.
 */
export async function baselineSecFilings(db: Firestore, companyId: string, log: MaintenanceLog,
  options: { source: SecFilingsSource; deadline: number; now?: () => number }) {
  validateCompany(companyId);
  const now = options.now ?? Date.now;
  if (!Number.isFinite(options.deadline) || options.deadline - now() > 18 * 60_000) throw new Error("Invalid baseline deadline");
  const canWork = () => now() + 30_000 < options.deadline;
  const result = { mode: "baseline-only", companyId, status: "completed", baselined: 0, existing: 0, published: 0, snapshotFilings: 0 };
  // An already finished canary is completely read-only, even if a prior success
  // response was lost. Recheck after acquiring the lease for concurrent finishes.
  if ((await readSecCollectorCursor(db, companyId))?.lastCompleteAt) return { ...result, status: "already-completed" };
  const metadata = secCollectorMetadata(db);
  if (!await acquireMaintenanceLease(metadata, log.runId, now(), cloudRunTaskAttempt())) throw new Error("SEC filing collector is busy");
  try {
    let cursor = await readSecCollectorCursor(db, companyId);
    if (cursor?.lastCompleteAt) return { ...result, status: "already-completed" };
    if (cursor?.scan?.baseline === false) throw new Error("Cannot baseline an existing nonbaseline scan");
    if (!canWork()) return { ...result, status: "partial" };
    if (!cursor?.scan?.baselineFilings) {
      const cik = await options.source.resolveCik(companyId);
      if (!/^\d{10}$/.test(cik) || Number(cik) === 0 || (cursor && cursor.cik !== cik)) throw new Error("SEC CIK conflicts with initial baseline");
      if (!canWork()) return { ...result, status: "partial" };
      const startedAt = new Date(now()).toISOString();
      const { recent } = await options.source.submissions(cik);
      if (recent.length > 2000 || Buffer.byteLength(JSON.stringify(recent), "utf8") > 256_000) throw new Error("SEC baseline exceeds the durable snapshot size limit");
      // Validate the complete snapshot before any filing or issuer-cursor write.
      for (const row of recent) createSecFilingDiscovered({ ...row, companyId, cik, discoveredAt: startedAt });
      cursor = { version: 1, cik, baselineAt: cursor?.baselineAt ?? startedAt, lastCompleteAt: null, nextPollAfterMs: 0,
        scan: { startedAt, baseline: true, fromDate: "0001-01-01", completedArchives: [], baselineFilings: recent } };
      await writeSecCollectorCursor(db, companyId, cursor);
    }
    const scan = cursor.scan!;
    result.snapshotFilings = scan.baselineFilings!.length;
    for (const row of scan.baselineFilings!) {
      if (!canWork()) return { ...result, status: "partial" };
      const event = createSecFilingDiscovered({ ...row, companyId, cik: cursor.cik, discoveredAt: scan.startedAt });
      const state = await persistSecFilingDiscovery(db, event, true);
      if (state === "baseline") result.baselined++;
      else result.existing++; // Existing pending/published records remain untouched.
    }
    await writeSecCollectorCursor(db, companyId, { ...cursor, lastCompleteAt: scan.startedAt, nextPollAfterMs: now() + 15 * 60_000, scan: null });
    return result;
  } finally {
    await releaseMaintenanceLease(metadata, log.runId);
  }
}
