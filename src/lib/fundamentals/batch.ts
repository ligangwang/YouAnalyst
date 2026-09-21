import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type { KnowledgeGraph } from "../knowledge-graph/model";
import { maintenanceError, type MaintenanceLog } from "../maintenance-log";
import { FUNDAMENTALS_COLLECTION, requestCompanyFundamentals, validFundamentalsTicker } from "./service";
import { refreshCompanyFundamentals } from "./worker";

export function usMapTickers(graph: Pick<KnowledgeGraph, "nodes">) {
  return [...new Set(graph.nodes.filter(node => node.kind === "COMPANY" && node.id.startsWith("US:"))
    .map(node => node.id.slice(3)).filter(validFundamentalsTicker))].sort();
}

export async function seedMapFundamentals(db: Firestore, tickers: string[]) {
  for (const ticker of tickers) await requestCompanyFundamentals(ticker, db);
  return auditMapFundamentals(db, tickers);
}

export async function auditMapFundamentals(db: Firestore, tickers: string[]) {
  const result = { companies: tickers.length, cached: 0, pending: 0, unavailable: 0, missing: [] as string[] };
  for (let offset = 0; offset < tickers.length; offset += 100) {
    const docs = await db.getAll(...tickers.slice(offset, offset + 100).map(t => db.collection(FUNDAMENTALS_COLLECTION).doc(t)));
    for (const doc of docs) {
      const data = doc.data();
      if (data?.version === 1 && data.value) result.cached++;
      if (data?.pending === true) result.pending++;
      if (data?.outcome === "unavailable") result.unavailable++;
      if (!(data?.version === 1 && data.value) && !data?.requestedAt) result.missing.push(doc.id);
    }
  }
  if (result.missing.length) throw new Error(`Map fundamentals coverage missing: ${result.missing.join(", ")}`);
  return result;
}

export async function drainFundamentalsQueue(db: Firestore, log: MaintenanceLog, deadline: number, refresh = refreshCompanyFundamentals) {
  const result = { processed: 0, failed: 0, deferred: 0, remaining: 0 };
  let cursor: string | undefined;
  let stop = false;
  while (!stop && Date.now() < deadline && result.processed < 500) {
    let query = db.collection(FUNDAMENTALS_COLLECTION).where("pending", "==", true).orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) {
      if (Date.now() >= deadline || result.processed >= 500) { stop = true; break; }
      cursor = doc.id;
      const queued = doc.data();
      if (Number(queued.refreshAfter) > Date.now()) {
        result.deferred++;
        if (queued.outcome === "retry") result.failed++;
        continue;
      }
      try {
        log.emit("INFO", "company_started", { ticker: doc.id });
        await refresh(doc.id, { db, log });
        result.processed++;
        log.emit("INFO", "company_completed", { ticker: doc.id });
      } catch (error) {
        result.processed++;
        result.failed++;
        const details = maintenanceError(error);
        log.emit("ERROR", "company_failed", { ticker: doc.id, error: details });
        // Do not hammer the provider after a block or rate-limit response.
        if (details.code === 403 || details.code === 429) { stop = true; break; }
      }
    }
    if (page.size < 100) break;
  }
  result.remaining = (await db.collection(FUNDAMENTALS_COLLECTION).where("pending", "==", true).count().get()).data().count;
  return result;
}
