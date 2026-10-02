import type { Firestore } from "firebase-admin/firestore";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../maintenance-lease";
import { maintenanceError, type MaintenanceLog } from "../maintenance-log";
import { createSecFilingDiscovered, type SecFilingDiscovered } from "./event";
import type { SecFiling, SecFilingsSource } from "./source";
import {
  listPendingSecFilings, markSecFilingPublished, persistSecFilingDiscovery, readSecCollectorCursor,
  secCollectorMetadata, writeSecCollectorCursor, type SecCollectorCursor,
} from "./store";

const OVERLAP_DAYS = 7;
const OPERATION_RESERVE_MS = 30_000;
export type SecCollectorOptions = {
  source: SecFilingsSource;
  publish: (event: SecFilingDiscovered) => Promise<string>;
  /** Absolute deadline; callers normally allow twelve minutes. */
  deadline: number;
  now?: () => number;
  maxCompanies?: number;
  maxArchivePagesPerCompany?: number;
  pollIntervalMs?: number;
  /** Optional bounded pre-filter sidecar, inside the same collector lease. */
  beforeCollection?: () => Promise<void>;
};
export type SecCollectorResult = {
  companies: number;
  inspected: number;
  completed: number;
  baselined: number;
  discovered: number;
  published: number;
  deferred: number;
  partial: number;
  failed: number;
  remaining: number;
  outboxIncomplete: boolean;
};

/** No SEC calls, lease writes, event creation, publication, or shared budget writes. */
export async function inspectSecFilingCollection(db: Firestore, companyIds: string[]) {
  const companies = validateCompanies(companyIds);
  const metadata = (await secCollectorMetadata(db).get()).data();
  let initialized = 0;
  for (const companyId of companies) if (await readSecCollectorCursor(db, companyId)) initialized++;
  const pending = await listPendingSecFilings(db, undefined, 100);
  return { dryRun: true, companies: companies.length, initialized, needingBaseline: companies.length - initialized,
    resumeAfter: metadata?.afterCompanyId ?? null, pendingFilingsSample: pending.length,
    pendingEventsSample: pending.reduce((count, filing) => count + filing.events.length, 0), sampleLimit: 100,
    baselinePolicy: "Record the first observed filings without publishing; emit subsequent unseen accessions", overlapDays: OVERLAP_DAYS };
}
function validateCompanies(companyIds: string[]) {
  if (!companyIds.length || companyIds.some(id => !/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(id))) {
    throw new Error("A nonempty list of current US graph tickers is required");
  }
  return [...new Set(companyIds)].sort();
}
function rotateCompanies(companies: string[], after: unknown) {
  if (typeof after !== "string") return companies;
  const next = companies.findIndex(company => company > after);
  return next < 0 ? companies : [...companies.slice(next), ...companies.slice(0, next)];
}

/**
 * A single durable collector lease owns discovery and publication. An uncertain
 * publish may redeliver the same eventId; consumers must deduplicate that ID.
 * Confirmed publications never enter the pending outbox again.
 */
export async function collectSecFilings(db: Firestore, companyIds: string[], log: MaintenanceLog, options: SecCollectorOptions) {
  const companies = validateCompanies(companyIds);
  const now = options.now ?? Date.now;
  const maxCompanies = options.maxCompanies ?? 500;
  const maxArchives = options.maxArchivePagesPerCompany ?? 20;
  const pollIntervalMs = options.pollIntervalMs ?? 15 * 60_000;
  if (!Number.isSafeInteger(maxCompanies) || maxCompanies < 1 || maxCompanies > 500
    || !Number.isSafeInteger(maxArchives) || maxArchives < 1 || maxArchives > 100
    || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 0
    || !Number.isFinite(options.deadline) || options.deadline - now() > 18 * 60_000) {
    throw new Error("Invalid SEC collector bounds");
  }
  const canWork = () => now() + OPERATION_RESERVE_MS < options.deadline;
  const result: SecCollectorResult = { companies: companies.length, inspected: 0, completed: 0,
    baselined: 0, discovered: 0, published: 0, deferred: 0, partial: 0, failed: 0, remaining: companies.length, outboxIncomplete: false };
  const metadata = secCollectorMetadata(db);
  if (!await acquireMaintenanceLease(metadata, log.runId, now(), cloudRunTaskAttempt())) throw new Error("SEC filing collector is busy");
  try {
    // Publication failures stop before further SEC requests. Events are durable
    // even if the originating ticker is no longer in the current graph.
    const drain = async () => {
      let after: string | undefined;
      for (;;) {
        if (!canWork()) { result.outboxIncomplete = true; return false; }
        const page = await listPendingSecFilings(db, after);
        if (!page.length) { result.outboxIncomplete = false; return true; }
        for (const filing of page) {
          for (const event of filing.events) {
            if (!canWork()) { result.outboxIncomplete = true; return false; }
            const messageId = await options.publish(event);
            if (!messageId) throw new Error("SEC filing publication was not confirmed");
            await markSecFilingPublished(db, event, new Date(now()).toISOString(), messageId);
            result.published++;
            log.emit("INFO", "filing_published", { companyId: event.companyId, accessionNumber: event.accessionNumber, eventId: event.eventId });
          }
          after = filing.accessionNumber;
        }
      }
    };
    if (!await drain()) return result;
    if (options.beforeCollection && canWork()) {
      try { await options.beforeCollection(); }
      catch (error) { log.emit("WARNING", "optional_discovery_incomplete", { error: maintenanceError(error), financialDiscoveryContinues: true }); }
    }
    const ordered = rotateCompanies(companies, (await metadata.get()).get("afterCompanyId"));
    for (const companyId of ordered) {
      if (!canWork() || result.inspected >= maxCompanies) break;
      result.inspected++;
      let providerBlocked = false;
      try {
        let cursor = await readSecCollectorCursor(db, companyId);
        if (cursor && !cursor.scan && cursor.nextPollAfterMs > now()) {
          result.deferred++;
        } else {
          const cik = await options.source.resolveCik(companyId);
          if (!/^\d{10}$/.test(cik) || Number(cik) === 0) throw new Error("Invalid resolved SEC CIK");
          if (!cursor || cursor.cik !== cik) {
            cursor = { version: 1, cik, baselineAt: new Date(now()).toISOString(), lastCompleteAt: null,
              nextPollAfterMs: 0, scan: null };
          }
          if (!cursor.scan) {
            cursor.scan = { startedAt: new Date(now()).toISOString(), baseline: cursor.lastCompleteAt === null,
              fromDate: cursor.lastCompleteAt === null ? "0001-01-01"
                : new Date(Date.parse(cursor.lastCompleteAt) - OVERLAP_DAYS * 86_400_000).toISOString().slice(0, 10),
              completedArchives: [], baselineFilings: null };
            await writeSecCollectorCursor(db, companyId, cursor);
          }
          const scan = cursor.scan;
          const persistRows = async (rows: SecFiling[]) => {
            for (const row of rows.filter(row => row.filingDate >= scan.fromDate)
              .sort((a, b) => a.filingDate.localeCompare(b.filingDate) || a.accessionNumber.localeCompare(b.accessionNumber))) {
              if (!canWork()) return false;
              const event = createSecFilingDiscovered({ ...row, companyId, cik, discoveredAt: new Date(now()).toISOString() });
              const baseline = scan.baseline && scan.baselineFilings!.some(filing => filing.accessionNumber === row.accessionNumber);
              const state = await persistSecFilingDiscovery(db, event, baseline);
              if (state === "baseline") result.baselined++;
              if (state === "pending") result.discovered++;
            }
            return true;
          };
          let complete = false;
          if (canWork()) {
            const submissions = await options.source.submissions(cik);
            if (scan.baseline && scan.baselineFilings === null) {
              if (submissions.recent.length > 2000 || Buffer.byteLength(JSON.stringify(submissions.recent), "utf8") > 256_000) throw new Error("SEC baseline exceeds the durable snapshot size limit");
              // Freeze exact rows before any ledger writes. New accessions later
              // the same day are events; initial rows survive moving to archives.
              scan.baselineFilings = submissions.recent;
              await writeSecCollectorCursor(db, companyId, cursor);
            }
            complete = !scan.baseline || await persistRows(scan.baselineFilings!);
            if (complete) complete = await persistRows(submissions.recent);
            // The first poll intentionally does not backfill historical archive
            // pages. Later polls cover downtime, even when recent is insufficient.
            const files = scan.baseline ? [] : submissions.files.filter(file => file.filingTo >= scan.fromDate)
              .sort((a, b) => a.filingFrom.localeCompare(b.filingFrom) || a.name.localeCompare(b.name));
            let fetchedArchives = 0;
            for (const file of files) {
              if (!complete) break;
              if (scan.completedArchives.includes(file.name)) continue;
              if (!canWork() || fetchedArchives >= maxArchives) { complete = false; break; }
              complete = await persistRows(await options.source.archive(cik, file.name));
              fetchedArchives++;
              if (complete) {
                scan.completedArchives.push(file.name);
                await writeSecCollectorCursor(db, companyId, cursor);
              }
            }
          }
          if (complete) {
            // The beginning of the completed scan is the watermark, never its
            // ending: a filing arriving during a long scan must remain eligible.
            const completed: SecCollectorCursor = { ...cursor, lastCompleteAt: scan.startedAt,
              nextPollAfterMs: now() + pollIntervalMs, scan: null };
            await writeSecCollectorCursor(db, companyId, completed);
            result.completed++;
            log.emit("INFO", "company_collected", { companyId, baseline: scan.baseline, cik });
          } else result.partial++;
        }
      } catch (error) {
        result.failed++;
        const details = maintenanceError(error);
        log.emit("ERROR", "company_failed", { companyId, error: details });
        providerBlocked = details.code === 403 || details.code === 429;
      }
      // Rotate even past a bad issuer; retries of its incomplete scan remain
      // durable and cannot starve every company after it in the map.
      await metadata.set({ afterCompanyId: companyId }, { merge: true });
      result.remaining--;
      if (providerBlocked) break; // The shared SEC gate persists the cooldown.
    }
    await drain();
    await metadata.set({ lastRunAt: new Date(now()).toISOString(), result }, { merge: true });
    return result;
  } finally {
    await releaseMaintenanceLease(metadata, log.runId);
  }
}
