import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadKnowledgeGraph } from "../src/lib/knowledge-graph/service";
import { auditMapFundamentals, drainFundamentalsQueue, seedMapFundamentals, usMapTickers } from "../src/lib/fundamentals/batch";
import { FUNDAMENTALS_COLLECTION } from "../src/lib/fundamentals/service";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../src/lib/maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";

const log = createMaintenanceLog("refresh-sec-fundamentals");
async function main() {
  if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT) throw new Error("GCP_PROJECT_ID and SEC_USER_AGENT are required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  const lease = db.collection(FUNDAMENTALS_COLLECTION).doc("_worker");
  if (!await acquireMaintenanceLease(lease, log.runId, Date.now(), cloudRunTaskAttempt())) throw new Error("Another fundamentals worker holds the lease");
  const deadline = Date.now() + 18 * 60_000;
  try {
    log.stage("seed_map");
    const tickers = usMapTickers(await loadKnowledgeGraph());
    if (!tickers.length) throw new Error("No US map companies found; refusing an incomplete coverage check");
    log.emit("INFO", "map_seeded", await seedMapFundamentals(db, tickers));
    if (process.argv.includes("--seed-only")) return;
    log.stage("fetch_queue");
    const result = await drainFundamentalsQueue(db, log, deadline);
    const coverage = await auditMapFundamentals(db, tickers);
    await lease.set({ lastRunAt: new Date().toISOString(), result, coverage }, { merge: true });
    log.emit(result.failed ? "ERROR" : "INFO", "run_completed", { ...result, coverage });
    if (result.failed) throw new Error(`${result.failed} fundamentals requests failed or are awaiting retry`);
  } finally {
    await releaseMaintenanceLease(lease, log.runId);
  }
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
