import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { digest } from "../fundamentals/pubsub";
import { publishJobMessage } from "../job-pubsub";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";
import { tickerSyncInput } from "./sync-input";
import { companyListingFields, prepareTickerCatalogSync, type TickerCatalogDocument, type TickerCatalogSyncResult } from "./sync-tickers";

type Input = ReturnType<typeof tickerSyncInput>;
export type TickerSyncRequest = { version: 1; type: "ticker-catalog.sync.requested"; batchId: string;
  requestedAt: string; requestedBy: string; input: Input };
type Item = { ticker: TickerCatalogDocument; company: boolean };
type Ledger = { request: TickerSyncRequest; prepared?: boolean; pages?: number; nextPage?: number;
  completed?: boolean; result?: TickerCatalogSyncResult };
const stateRef = (db: Firestore) => db.collection("directory_syncs").doc("TICKER_CATALOG");
const ledgerRef = (db: Firestore, id: string) => db.collection("directory_syncs").doc(`_ticker_${id}`);
const pageRef = (db: Firestore, id: string, page: number) => db.collection("directory_syncs").doc(`_ticker_${id}_page_${page}`);
const busy = () => Object.assign(Error("Ticker sync is already queued or running."), { code: "ALREADY_RUNNING" });

export function parseTickerSyncRequest(value: unknown): TickerSyncRequest {
  const v = value as Partial<TickerSyncRequest> | null;
  if (!v || v.version !== 1 || v.type !== "ticker-catalog.sync.requested"
    || typeof v.batchId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.batchId)
    || typeof v.requestedAt !== "string" || !Number.isFinite(Date.parse(v.requestedAt))
    || typeof v.requestedBy !== "string" || !v.requestedBy || v.requestedBy.length > 128) throw Error("Invalid ticker sync request");
  const input = tickerSyncInput(v.input);
  if (input.dryRun) throw Error("Preview cannot be queued for writing");
  // Firestore rejects undefined optional fields; canonicalize before saving.
  return JSON.parse(JSON.stringify({ version: 1, type: v.type, batchId: v.batchId,
    requestedAt: v.requestedAt, requestedBy: v.requestedBy, input })) as TickerSyncRequest;
}

export async function queueTickerSync(input: Input, uid: string, db: Firestore,
  publish: (request: TickerSyncRequest) => Promise<unknown> = request =>
    publishJobMessage(process.env.TICKER_SYNC_REQUEST_TOPIC || "ticker-catalog-requests", request), now = Date.now()) {
  const proposed = parseTickerSyncRequest({ version: 1, type: "ticker-catalog.sync.requested", batchId: randomUUID(),
    requestedAt: new Date(now).toISOString(), requestedBy: uid, input });
  const state = stateRef(db);
  const request = await db.runTransaction(async tx => {
    const data = (await tx.get(state)).data();
    if (Number(data?.leaseExpiresAtMs) > now || Number(data?.dispatchAfter) > now) throw busy();
    let request = proposed;
    if (data?.activeRequest) {
      request = parseTickerSyncRequest(data.activeRequest);
      if (digest(request.input) !== digest(proposed.input)) throw busy();
    } else {
      tx.create(ledgerRef(db, proposed.batchId), { request: proposed });
    }
    // Keep the original request even if publication is ambiguous. A retry with
    // identical options republishes it instead of creating overlapping imports.
    tx.set(state, { activeRequest: request, dispatchAfter: now + 30_000 }, { merge: true });
    return request;
  });
  await publish(request);
  return { queued: true, dryRun: false, runId: request.batchId };
}

function snapshotPages(documents: TickerCatalogDocument[]) {
  const best = new Map<string, TickerCatalogDocument>();
  for (const ticker of documents) if (!best.has(ticker.symbol) || ticker.exchangePriority > best.get(ticker.symbol)!.exchangePriority) best.set(ticker.symbol, ticker);
  const pages: Item[][] = [];
  let page: Item[] = [], bytes = 0;
  for (const ticker of documents) {
    const item = { ticker, company: best.get(ticker.symbol)!.id === ticker.id };
    const size = Buffer.byteLength(JSON.stringify(item));
    if (size > 700_000) throw Error("Ticker record exceeds snapshot size limit");
    if (page.length && (page.length >= 100 || bytes + size > 700_000)) { pages.push(page); page = []; bytes = 0; }
    page.push(item); bytes += size;
  }
  if (page.length) pages.push(page);
  return pages;
}

export async function processTickerSync(input: unknown, db: Firestore, log: MaintenanceLog,
  dependencies: { prepare?: typeof prepareTickerCatalogSync; deadline?: number } = {}) {
  const request = parseTickerSyncRequest(input);
  const state = stateRef(db), ref = ledgerRef(db, request.batchId);
  if (!await acquireMaintenanceLease(state, log.runId)) throw busy();
  const deadline = dependencies.deadline ?? Date.now() + 7 * 60_000;
  try {
    let ledger = (await ref.get()).data() as Ledger | undefined;
    if (!ledger || digest(ledger.request) !== digest(request)) throw Error("Unknown or conflicting ticker sync request");
    if (ledger.completed) return { ...ledger.result!, duplicate: true };
    if ((await state.get()).data()?.activeRequest?.batchId !== request.batchId) throw Error("Ticker request is no longer active");
    if (!ledger.prepared) {
      const { documents, result } = await (dependencies.prepare ?? prepareTickerCatalogSync)(request.input, request.batchId);
      const pages = snapshotPages(documents);
      for (let i = 0; i < pages.length; i++) {
        if (Date.now() > deadline - 60_000) throw Error("Snapshot preparation needs retry");
        await pageRef(db, request.batchId, i).set({ items: pages[i] });
      }
      ledger = { ...ledger, prepared: true, pages: pages.length, nextPage: 0, result };
      await ref.set(ledger);
    }
    for (let i = ledger.nextPage!; i < ledger.pages!; i++) {
      if (Date.now() > deadline - 60_000) throw Error("Ticker sync incomplete; retry remaining pages");
      const items = (await pageRef(db, request.batchId, i).get()).data()?.items as Item[] | undefined;
      if (!items) throw Error("Ticker snapshot page missing");
      const companies = items.filter(item => item.company);
      await db.runTransaction(async tx => {
        const lease = (await tx.get(state)).data();
        if (lease?.leaseOwner !== log.runId || Number(lease.leaseExpiresAtMs) <= Date.now()) throw Error("Ticker lease expired");
        const progress = (await tx.get(ref)).data() as Ledger;
        if (progress.nextPage !== i) throw Error("Ticker progress changed");
        const refs = companies.map(item => db.collection("companies").doc(`US:${item.ticker.symbol}`));
        const existing = refs.length ? await tx.getAll(...refs, { fieldMask: ["names", "aliases"] }) : [];
        companies.forEach((item, j) => tx.set(refs[j], companyListingFields(item.ticker, existing[j].data()), { merge: true }));
        for (const { ticker } of items) tx.set(db.collection("tickers").doc(ticker.id), ticker, { merge: true });
        tx.update(ref, { nextPage: i + 1, result: { ...progress.result!,
          written: progress.result!.written + items.length, batchesCommitted: i + 1 } });
      });
      log.emit("INFO", "page_completed", { batchId: request.batchId, page: i, written: items.length });
    }
    return await db.runTransaction(async tx => {
      const lease = (await tx.get(state)).data();
      const finished = (await tx.get(ref)).data() as Ledger;
      if (lease?.leaseOwner !== log.runId || Number(lease.leaseExpiresAtMs) <= Date.now()
        || lease.activeRequest?.batchId !== request.batchId || finished.nextPage !== finished.pages) throw Error("Ticker completion requires retry");
      tx.update(ref, { completed: true, completedAt: new Date().toISOString() });
      tx.set(state, { activeRequest: null, dispatchAfter: 0, lastResult: finished.result }, { merge: true });
      return finished.result!;
    });
  } finally { await releaseMaintenanceLease(state, log.runId); }
}
