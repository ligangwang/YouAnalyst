import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "../firebase/admin";
import { digest } from "../fundamentals/pubsub";
import { publishJobMessage } from "../job-pubsub";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";
import { marketDate, predictionInstrument } from "./instrument";
import { readRollForwardDates, runDailyEodMaintenance, type DailyEodMaintenanceInput } from "./eod-prices";

type Input = Omit<DailyEodMaintenanceInput, "afterPredictionId" | "dryRun"> & { market: "US" | "CN_A"; runDate: string };
export type EodRequest = { version: 1; type: "eod.maintenance.requested"; batchId: string; requestedAt: string; input: Input };
type Ledger = { request: EodRequest; dates?: string[]; nextRunDate?: string | null; dateIndex?: number; cursor?: string | null; completed?: boolean; pages?: number };
const stateRef = (db: Firestore, market: string) => db.collection("eod_runs").doc(`_queue_${market}`);
const dispatchRef = (db: Firestore, input: Input) => db.collection("eod_runs").doc(`_dispatch_${digest(input)}`);
const ledgerRef = (db: Firestore, id: string) => db.collection("eod_runs").doc(`_request_${id}`);
const busy = () => Object.assign(Error("EOD maintenance is already queued or running for this market"), { code: "EOD_ALREADY_RUNNING" });
const invalid = () => Object.assign(Error("Invalid EOD request"), { code: "INVALID_EOD_REQUEST" });

export function eodQueueInput(value: DailyEodMaintenanceInput): Input {
  const market = value.market ?? "US", runDate = value.runDate ?? marketDate(market);
  const date = new Date(`${runDate}T00:00:00Z`);
  if (!["US", "CN_A"].includes(market) || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)
    || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== runDate || runDate > marketDate(market)
    || value.dryRun || value.afterPredictionId !== undefined) throw invalid();
  for (const key of ["loadPrices", "markPredictions", "rollForward", "recompute"] as const)
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw invalid();
  for (const key of ["limit", "rollForwardBatchSize"] as const)
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key]! < 1)) throw invalid();
  if (value.tickers !== undefined && (!Array.isArray(value.tickers) || value.tickers.length > 500
    || value.tickers.some(ticker => typeof ticker !== "string" || predictionInstrument(ticker)?.market !== market))) throw invalid();
  if (value.trigger !== undefined && value.trigger !== "admin") throw invalid();
  if (value.requestedBy !== undefined && (typeof value.requestedBy !== "string" || !value.requestedBy || value.requestedBy.length > 128)) throw invalid();
  return JSON.parse(JSON.stringify({ market, runDate, limit: Math.min(value.limit ?? 50, 50),
    tickers: value.tickers, loadPrices: value.loadPrices, markPredictions: value.markPredictions,
    rollForward: value.rollForward, rollForwardBatchSize: Math.min(value.rollForwardBatchSize ?? 5, 20),
    recompute: value.recompute, trigger: value.trigger, requestedBy: value.requestedBy }));
}
export function parseEodRequest(value: unknown): EodRequest {
  const v = value as Partial<EodRequest> | null;
  if (!v || v.version !== 1 || v.type !== "eod.maintenance.requested" || typeof v.batchId !== "string"
    || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.batchId) || typeof v.requestedAt !== "string" || !Number.isFinite(Date.parse(v.requestedAt))
    || !v.input || !v.input.runDate || !v.input.market) throw invalid();
  return { version: 1, type: v.type, batchId: v.batchId, requestedAt: v.requestedAt, input: eodQueueInput(v.input) };
}

export async function queueEodMaintenance(value: DailyEodMaintenanceInput = {}, db = getAdminFirestore(),
  publish: (request: EodRequest) => Promise<unknown> = request => publishJobMessage(process.env.EOD_REQUEST_TOPIC || "eod-maintenance-requests", request), now = Date.now()) {
  const input = eodQueueInput(value);
  // Scheduler retries after an ambiguous HTTP response reuse the same daily request.
  const batchId = input.trigger === "admin" ? randomUUID() : digest(input);
  const proposed = parseEodRequest({ version: 1, type: "eod.maintenance.requested", batchId, requestedAt: new Date(now).toISOString(), input });
  const state = dispatchRef(db, input);
  const request = await db.runTransaction(async tx => {
    const data = (await tx.get(state)).data();
    const existing = (await tx.get(ledgerRef(db, batchId))).data() as Ledger | undefined;
    let request = existing?.request ?? proposed;
    if (data?.activeRequest) {
      const active = parseEodRequest(data.activeRequest);
      if (digest(active.input) !== digest(input)) throw busy();
      request = active;
    } else if (!existing) tx.create(ledgerRef(db, batchId), { request });
    if (!existing?.completed) tx.set(state, { activeRequest: request }, { merge: true });
    return request;
  });
  await publish(request);
  return { queued: true as const, runId: request.batchId, market: input.market, runDate: input.runDate };
}

export async function processEodMaintenance(value: unknown, db: Firestore, log: MaintenanceLog,
  dependencies: { run?: typeof runDailyEodMaintenance; dates?: typeof readRollForwardDates; deadline?: number } = {}) {
  const request = parseEodRequest(value), state = stateRef(db, request.input.market), ref = ledgerRef(db, request.batchId);
  if (!await acquireMaintenanceLease(state, log.runId)) throw busy();
  try {
    let ledger = (await ref.get()).data() as Ledger | undefined;
    if (!ledger || digest(ledger.request) !== digest(request)) throw Error("Unknown or conflicting EOD request");
    if (ledger.completed) return { duplicate: true, batchId: request.batchId };
    if (!ledger.dates) {
      const count = request.input.rollForwardBatchSize!;
      const available = request.input.rollForward
        ? await (dependencies.dates ?? readRollForwardDates)(db, request.input.runDate, count + 1) : [request.input.runDate];
      ledger = { ...ledger, dates: available.slice(0, count), nextRunDate: available[count] ?? null, dateIndex: 0, cursor: null, pages: 0 };
      await ref.set(ledger);
    }
    const deadline = dependencies.deadline ?? Date.now() + 7 * 60_000;
    while (ledger.dateIndex! < ledger.dates!.length) {
      if (Date.now() > deadline - 60_000) throw Error("EOD needs another delivery to finish remaining pages");
      const result = await (dependencies.run ?? runDailyEodMaintenance)({ ...request.input,
        runDate: ledger.dates![ledger.dateIndex!], rollForward: false, afterPredictionId: ledger.cursor ?? undefined });
      if (result.priceLoad.failed || result.fx?.failed || result.marking.missingPrice) {
        log.emit("WARNING", "page_incomplete", { batchId: request.batchId, market: request.input.market,
          runDate: result.runDate, priceLoad: { failed: result.priceLoad.failed, failures: result.priceLoad.failures },
          fx: result.fx ?? null, marking: result.marking });
        throw Error("EOD has incomplete prices or scores; retry this page before advancing");
      }
      if (result.hasMoreCandidatePredictions && (!result.nextPredictionId || result.nextPredictionId === ledger.cursor)) throw Error("EOD cursor did not advance");
      const next: Ledger = { ...ledger, dateIndex: ledger.dateIndex! + (result.hasMoreCandidatePredictions ? 0 : 1),
        cursor: result.hasMoreCandidatePredictions ? result.nextPredictionId! : null, pages: ledger.pages! + 1 };
      await db.runTransaction(async tx => {
        const lease = (await tx.get(state)).data();
        const saved = (await tx.get(ref)).data() as Ledger;
        if (lease?.leaseOwner !== log.runId || Number(lease.leaseExpiresAtMs) <= Date.now() || saved.pages !== ledger!.pages) throw Error("EOD checkpoint lease/progress changed");
        tx.set(ref, next);
      });
      ledger = next;
      log.emit("INFO", "page_completed", { batchId: request.batchId, market: request.input.market, runDate: result.runDate,
        pages: ledger.pages, hasMoreCandidatePredictions: result.hasMoreCandidatePredictions });
    }
    await db.runTransaction(async tx => {
      const lease = (await tx.get(state)).data();
      const dispatch = dispatchRef(db, request.input);
      const active = (await tx.get(dispatch)).data()?.activeRequest;
      if (lease?.leaseOwner !== log.runId || Number(lease.leaseExpiresAtMs) <= Date.now() || active?.batchId !== request.batchId) throw Error("EOD completion requires retry");
      tx.update(ref, { completed: true, completedAt: new Date().toISOString() });
      tx.set(dispatch, { activeRequest: null }, { merge: true });
    });
    return { batchId: request.batchId, market: request.input.market, pages: ledger.pages, dates: ledger.dates, nextRunDate: ledger.nextRunDate };
  } finally { await releaseMaintenanceLease(state, log.runId); }
}

