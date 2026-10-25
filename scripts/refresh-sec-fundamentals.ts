import { closeLocalCaches } from '../src/lib/local-cache/watch';
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { loadFundamentalsCompanyIds } from "../src/lib/fundamentals/company-scope";
import { usFundamentalsTicker } from "../src/lib/fundamentals/identity";
import { FUNDAMENTALS_COLLECTION } from "../src/lib/fundamentals/service";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../src/lib/maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { backfillLatestEod } from "../src/lib/predictions/backfill-latest-eod";
import { verifyFundamentalsDelivery } from "../src/lib/fundamentals/pubsub-batch";
import { publishFundamentalsMessage } from "../src/lib/fundamentals/pubsub";
import {queueFundamentalsSeeding} from '../src/lib/fundamentals/seed-queue';

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
  try {
    if (process.argv.includes("--backfill-latest-only")) {
      log.stage("backfill_latest_prices");
      await backfillLatestEod(db, true);
      log.emit("INFO", "run_completed", {backfill:true});
      return;
    }
    log.stage("seed_map");
    const companyIds = await loadFundamentalsCompanyIds(db, "US");
    // Provider messages retain raw tickers; storage converts them back to US: keys.
    const tickers = companyIds.map(id => usFundamentalsTicker(id)!);
    if (!tickers.length) throw new Error("No US map companies found; refusing an incomplete coverage check");
    const topic=process.env.FUNDAMENTALS_REQUEST_TOPIC;
    if(!topic)throw Error('Fundamentals request queue is required');
    if(process.argv.includes('--direct'))throw Error('Direct all-company refresh is retired; use the queued publisher');
    const result=await queueFundamentalsSeeding(db,process.env.CLOUD_RUN_EXECUTION??log.runId,companyIds,topic,process.argv.includes('--seed-only'));
    log.emit('INFO','seeding_queued',result);
  } finally {
    await releaseMaintenanceLease(lease, log.runId);
  }
}
main().finally(closeLocalCaches).catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
