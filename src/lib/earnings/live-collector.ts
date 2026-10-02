import type { Firestore } from "firebase-admin/firestore";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";
import { discoverEarningsSource, earningsMetadata, EARNINGS_RECORDS, EARNINGS_SOURCES, publishEarningsOutbox, type EarningsWork } from "./live-store";
import { earningsPilot } from "./pilot";
import { earningsScanWindow } from "./sec-observer";
import type { EarningsSource } from "./model";
import type { EarningsSourceDiscovered } from "./live-event";

export type EarningsDiscovery = (companyId: string, from: string, to: string, firstSeenAt: string) => Promise<EarningsSource[]>;
export async function collectLiveEarnings(db: Firestore, log: MaintenanceLog, options: {
  discoverCn: EarningsDiscovery; publish: (event: EarningsSourceDiscovered) => Promise<string>;
  deadline: number; now?: () => number;
}) {
  const now = options.now ?? Date.now, meta = earningsMetadata(db, "collector"), startedAt = now();
  if (!Number.isFinite(options.deadline) || options.deadline <= startedAt || options.deadline - startedAt > 15 * 60_000) throw new Error("Invalid earnings collector deadline");
  if (!await acquireMaintenanceLease(meta, log.runId, startedAt, cloudRunTaskAttempt())) throw new Error("Earnings collector is busy");
  const result = { companies: 0, skipped: 0, candidates: 0, queued: 0, published: 0, failed: 0, deferred: 0 };
  try {
    for (const company of earningsPilot.filter(item => !item.cik)) {
      if (now() + 30_000 >= options.deadline) { result.deferred++; continue; }
      const cursorRef = earningsMetadata(db, `cn_${company.companyId}`), cursor = (await cursorRef.get()).data();
      if (Number(cursor?.nextPollAtMs) > now()) { result.skipped++; continue; }
      result.companies++;
      const scanStartedAt = now();
      try {
        // CNINFO's disclosure-date filter uses the issuer's local calendar day.
        const window = earningsScanWindow(cursor, scanStartedAt, 8);
        const sources = await options.discoverCn(company.companyId, window.from, window.to, new Date(scanStartedAt).toISOString());
        if (sources.length > 100) throw new Error("CN earnings source budget exceeded; cursor retained");
        result.candidates += sources.length;
        for (const source of sources) {
          if (source.companyId !== company.companyId || source.provider !== "cninfo") throw new Error("CN source issuer/provider mismatch");
          if (now() + 15_000 >= options.deadline) throw new Error("CN earnings persistence deadline reached; cursor retained");
          if ((await discoverEarningsSource(db, source, "document", now())).status === "queued") result.queued++;
        }
        await cursorRef.set({ companyId: company.companyId, status: "complete", lastCompleteAt: new Date(scanStartedAt).toISOString(),
          revision: process.env.GIT_SHA ?? "local", execution: process.env.CLOUD_RUN_EXECUTION ?? null,
          ...(window.reconcile ? { lastReconcileAt: new Date(scanStartedAt).toISOString() } : {}),
          nextPollAtMs: scanStartedAt + 60 * 60_000, from: window.from, to: window.to, candidates: sources.length, lastError: null }, { merge: true });
      } catch (error) {
        result.failed++;
        const reason = error instanceof Error ? error.message : "CN earnings source failed";
        await cursorRef.set({ companyId: company.companyId, status: "partial", lastAttemptAt: new Date(now()).toISOString(), lastError: reason.slice(0, 1000) }, { merge: true });
        log.emit("WARNING", "earnings_cn_scan_incomplete", { companyId: company.companyId, reason });
      }
    }
    if (now() + 30_000 < options.deadline) {
      const drained = await publishEarningsOutbox(db, options.publish, 50); result.published = drained.published;
      if (drained.limitReached) result.deferred++;
    } else result.deferred++;
    await meta.set({ lastRun: { ...result, runId: log.runId, startedAt: new Date(startedAt).toISOString(), completedAt: new Date(now()).toISOString(),
      execution: process.env.CLOUD_RUN_EXECUTION ?? null, revision: process.env.GIT_SHA ?? "local", status: result.failed || result.deferred ? "partial" : "complete" } }, { merge: true });
    return result;
  } finally { await releaseMaintenanceLease(meta, log.runId); }
}
/** Bounded read-only diagnostics. Truncation is explicit, not a completeness claim. */
export async function inspectLiveEarnings(db: Firestore) {
  const sources = await db.collection(EARNINGS_SOURCES).where("recordType", "==", "source").limit(501).get();
  const records = await db.collection(EARNINGS_RECORDS).where("recordType", "==", "revision").limit(201).get();
  const sourceRows = sources.docs.slice(0, 500).map(doc => doc.data() as EarningsWork);
  const states: Record<string, number> = {};
  for (const row of sourceRows) states[row.status] = (states[row.status] ?? 0) + 1;
  const cursors: Record<string, unknown> = {};
  for (const company of earningsPilot) cursors[company.companyId] = (await earningsMetadata(db, company.cik ? `us_${company.cik}` : `cn_${company.companyId}`).get()).data() ?? null;
  return { status: "read_only", revision: process.env.GIT_SHA ?? "local", sources: sourceRows.length, sourceStates: states,
    validatedRevisions: Math.min(records.size, 200), sampleTruncated: sources.size > 500 || records.size > 200,
    unsupported: sourceRows.filter(row => row.status === "review_required").slice(0, 30).map(row => ({ sourceId: row.sourceId, companyId: row.source.companyId, reason: row.reason, sourceUrl: row.source.url })),
    byCompany: earningsPilot.map(company => ({ companyId: company.companyId, sourceCount: sourceRows.filter(row => row.source.companyId === company.companyId).length,
      extractedSourceCount: sourceRows.filter(row => row.source.companyId === company.companyId && row.status === "extracted").length })),
    cursors, lastRun: (await earningsMetadata(db, "collector").get()).get("lastRun") ?? null,
    lastProbe: (await earningsMetadata(db, "last_probe").get()).data() ?? null,
    lastCanary: (await earningsMetadata(db, "last_canary").get()).data() ?? null,
    providerRequests: 0, externalWrites: 0 };
}
