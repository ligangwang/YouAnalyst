import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../maintenance-log";
import type { SecFilingsSource, SecRawSubmissionsObserver } from "../sec-filings/source";
import { discoverSecEarnings } from "./discovery";
import { discoverEarningsSource, earningsMetadata } from "./live-store";
import { earningsCompanies } from "./issuers";
import { validDate } from "./model";

export const EARNINGS_INITIAL_LOOKBACK_DAYS = 180;
export const EARNINGS_OVERLAP_DAYS = 7;
const DAY = 86_400_000;
export function secEarningsCursorId(companyId: string) {
  if (!/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(companyId)) throw new Error('Invalid earnings cursor listing');
  return `us_${companyId.replaceAll('.', '_')}`;
}
export function earningsScanWindow(cursor: Record<string, unknown> | undefined, now: number, localOffsetHours = 0) {
  const reconcile = !Number.isFinite(Date.parse(String(cursor?.lastReconcileAt))) || now - Date.parse(String(cursor?.lastReconcileAt)) >= DAY;
  const previous = Date.parse(String(cursor?.lastCompleteAt));
  if (Number.isFinite(previous) && previous > now + 60_000) throw new Error("Earnings cursor is ahead of collection time");
  const offset = localOffsetHours * 3_600_000;
  const from = new Date((reconcile || !Number.isFinite(previous) ? now - EARNINGS_INITIAL_LOOKBACK_DAYS * DAY : previous - EARNINGS_OVERLAP_DAYS * DAY) + offset).toISOString().slice(0, 10);
  return { from, to: new Date(now + offset).toISOString().slice(0, 10), reconcile };
}
/** Passive pre-filter view of the existing SEC scanner. Its strict financial
 * event is unchanged. Errors are recorded separately and do not suppress annual
 * financial discovery for an otherwise valid SEC response. */
export function createSecEarningsObserver(db: Firestore, log: MaintenanceLog, options: { now?: () => number; deadline: number }) {
  const now = options.now ?? Date.now, observed = new Set<string>(), failed = new Set<string>();
  const observe: SecRawSubmissionsObserver = async (cik, value, archive) => {
    for (const company of earningsCompanies().filter(item => item.cik === cik)) {
    if (observed.has(company.companyId)) continue;
    const meta = earningsMetadata(db, secEarningsCursorId(company.companyId));
    try {
      const saved = (await meta.get()).data();
      const legacy = saved ? undefined : (await earningsMetadata(db, `us_${cik}`).get()).data();
      const cursor = saved ?? (legacy?.companyId === company.companyId ? legacy : undefined);
      const window = earningsScanWindow(cursor, now());
      const payload = value as { cik?: unknown; filings?: { recent?: Record<string, unknown>; files?: Array<{ name: string; filingFrom: string; filingTo: string }> } };
      if (!payload.filings || !Array.isArray(payload.filings.files)) throw new Error("Missing SEC archive coverage metadata");
      const recent = payload.filings.recent;
      if (!Array.isArray(recent?.filingDate) || !recent.filingDate.every(validDate)) throw new Error("Invalid SEC recent date coverage");
      const rows = [...discoverSecEarnings(company.companyId, payload, new Date(now()).toISOString())];
      const files = payload.filings.files.filter(file => file.filingTo >= window.from);
      if (files.length > 5) throw new Error("SEC earnings archive budget exhausted; checkpoint retained");
      for (const file of files) {
        if (!new RegExp(`^CIK${cik}-submissions-\\d+\\.json$`).test(file.name) || !validDate(file.filingFrom) || !validDate(file.filingTo)) throw new Error("Invalid SEC earnings archive metadata");
        if (now() + 30_000 >= options.deadline) throw new Error("SEC earnings scan deadline reached; checkpoint retained");
        const raw = await archive(file.name) as Record<string, unknown>;
        rows.push(...discoverSecEarnings(company.companyId, { cik, filings: { recent: raw } }, new Date(now()).toISOString()));
      }
      const candidates = [...new Map(rows.filter(source => /^(?:8-K|6-K)(?:\/A)?$/.test(source.form ?? "") && source.filingDate! >= window.from && source.filingDate! <= window.to).map(source => [source.documentId, source])).values()];
      if (candidates.length > 200) throw new Error("SEC earnings candidate budget exhausted; checkpoint retained");
      let queued = 0;
      for (const source of candidates) {
        if (now() + 15_000 >= options.deadline) throw new Error("SEC earnings persistence deadline reached; checkpoint retained");
        if ((await discoverEarningsSource(db, source, "sec_filing", now())).status === "queued") queued++;
      }
      const completedAt = new Date(now()).toISOString();
      await meta.set({ companyId: company.companyId, lastCompleteAt: completedAt, ...(window.reconcile ? { lastReconcileAt: completedAt } : {}),
        revision: process.env.GIT_SHA ?? "local", execution: process.env.CLOUD_RUN_EXECUTION ?? null,
        from: window.from, to: window.to, candidates: candidates.length, queued, archives: files.length, status: "complete", lastError: null }, { merge: true });
      observed.add(company.companyId); failed.delete(company.companyId);
      log.emit("INFO", "earnings_sec_snapshot", { companyId: company.companyId, candidates: candidates.length, queued, archives: files.length });
    } catch (error) {
      failed.add(company.companyId);
      const message = error instanceof Error ? error.message : "SEC earnings discovery failed";
      await meta.set({ companyId: company.companyId, status: "partial", lastAttemptAt: new Date(now()).toISOString(), lastError: message.slice(0, 1000) }, { merge: true });
      log.emit("WARNING", "earnings_sec_snapshot_incomplete", { companyId: company.companyId, reason: message });
    }
    }
  };
  return { observe, observed, failed,
    async scanMap(source: SecFilingsSource, tickers: readonly string[]) {
      for (const ticker of tickers) {
        const companyId = `US:${ticker}`;
        if (observed.has(companyId)) continue;
        if (now() + 30_000 >= options.deadline) { failed.add(companyId); continue; }
        try { await source.submissions(await source.resolveCik(ticker)); }
        catch (error) { failed.add(companyId); log.emit("WARNING", "earnings_sec_request_incomplete", { companyId, reason: error instanceof Error ? error.message : "SEC source failed" }); }
      }
      return { observed: observed.size, failed: failed.size };
    },
  };
}
