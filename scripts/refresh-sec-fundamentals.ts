import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadKnowledgeGraph } from "../src/lib/knowledge-graph/service";
import { auditMapFundamentals, drainFundamentalsQueue, seedMapFundamentals, usMapTickers } from "../src/lib/fundamentals/batch";
import { FUNDAMENTALS_COLLECTION } from "../src/lib/fundamentals/service";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../src/lib/maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { refreshCachedMarketCaps } from "../src/lib/fundamentals/market-cap";
import { backfillLatestEod } from "../src/lib/predictions/backfill-latest-eod";
import { publishPendingFundamentals, verifyFundamentalsDelivery } from "../src/lib/fundamentals/pubsub-batch";
import { publishFundamentalsMessage } from "../src/lib/fundamentals/pubsub";

const log = createMaintenanceLog("refresh-sec-fundamentals");
async function main() {
  if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT) throw new Error("GCP_PROJECT_ID and SEC_USER_AGENT are required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  if (process.env.FUNDAMENTALS_VERIFY_ONLY === "1") {
    if (!process.env.FUNDAMENTALS_REQUEST_TOPIC) throw new Error("Verification requires Pub/Sub mode");
    const result = await verifyFundamentalsDelivery(db, log.runId,
      request => publishFundamentalsMessage(process.env.FUNDAMENTALS_REQUEST_TOPIC!, request), log);
    log.emit("INFO", "run_completed", { verification: true, ...result });
    return;
  }
  const lease = db.collection(FUNDAMENTALS_COLLECTION).doc("_worker");
  if (!await acquireMaintenanceLease(lease, log.runId, Date.now(), cloudRunTaskAttempt())) throw new Error("Another fundamentals worker holds the lease");
  const deadline = Date.now() + 18 * 60_000;
  try {
    if (process.argv.includes("--backfill-latest-only")) {
      log.stage("backfill_latest_prices");
      await backfillLatestEod(db, true);
      log.emit("INFO", "run_completed", {backfill:true});
      return;
    }
    log.stage("seed_map");
    const tickers = usMapTickers(await loadKnowledgeGraph());
    if (!tickers.length) throw new Error("No US map companies found; refusing an incomplete coverage check");
    log.emit("INFO", "map_seeded", await seedMapFundamentals(db, tickers));
    if (process.argv.includes("--seed-only")) return;
    log.stage("fetch_queue");
    // Reserve time for valuation updates even when SEC requests consume their budget.
    const topic = process.env.FUNDAMENTALS_REQUEST_TOPIC;
    const asynchronous = Boolean(topic && !process.argv.includes("--direct"));
    const result = asynchronous
      ? await publishPendingFundamentals(db, process.env.CLOUD_RUN_EXECUTION ?? log.runId,
        request => publishFundamentalsMessage(topic!, request), log)
      : await drainFundamentalsQueue(db, log, deadline - 120_000);
    const coverage = await auditMapFundamentals(db, tickers);
    log.stage("market_caps");
    const marketCaps = await refreshCachedMarketCaps(db, log, deadline);
    await lease.set({ lastRunAt: new Date().toISOString(), result, coverage, marketCaps }, { merge: true });
    const failed = ("failed" in result && result.failed) || marketCaps.failed || marketCaps.incomplete;
    log.emit(failed ? "ERROR" : "INFO", "run_completed", { ...result, coverage, marketCaps });
    if (failed) throw new Error("Fundamentals or market-cap refresh failed or is incomplete; see run summary");
  } finally {
    await releaseMaintenanceLease(lease, log.runId);
  }
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
