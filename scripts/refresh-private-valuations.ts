import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../src/lib/maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { checkPrivateValuation, privateValuationSources } from "../src/lib/fundamentals/private-valuations";
import { publishPrivateValuationChecks } from "../src/lib/fundamentals/private-valuation-pubsub";
import { publishJobMessage } from "../src/lib/job-pubsub";

const dryRun = process.argv.includes("--dry-run");
const sourcesOnly = process.argv.includes("--sources-only");
const log = createMaintenanceLog("refresh-private-valuations", { dryRun });

async function main() {
  if (sourcesOnly) {
    if (!dryRun) throw Error("--sources-only requires --dry-run");
    let failures = 0;
    for (const id of Object.keys(privateValuationSources)) {
      try { console.log(JSON.stringify({ id, ...await checkPrivateValuation(id) })); }
      catch (error) { failures++; log.emit("ERROR", "company_failed", { company: id, error: maintenanceError(error) }); }
    }
    if (failures) throw Error(`${failures} official source checks failed`);
    return;
  }
  if (!process.env.GCP_PROJECT_ID) throw Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  if (!dryRun && !process.argv.includes("--direct") && process.env.PRIVATE_VALUATIONS_REQUEST_TOPIC) {
    log.emit("INFO", "run_started", { mode: "pubsub" });
    const result = await publishPrivateValuationChecks(db, process.env.CLOUD_RUN_EXECUTION || log.runId,
      request => publishJobMessage(process.env.PRIVATE_VALUATIONS_REQUEST_TOPIC!, request), log);
    log.emit("INFO", "run_completed", result);
    return;
  }
  const lease = db.collection("company_fundamentals").doc("_private_valuation_worker");
  if (!dryRun && !await acquireMaintenanceLease(lease, log.runId, Date.now(), cloudRunTaskAttempt())) throw Error("Another private valuation worker holds the lease");
  const counts = { companies: 0, verified: 0, review_required: 0, stale: 0, unsupported: 0, failed: 0 };
  const deadline = Date.now() + 18 * 60_000;
  try {
    const [current, legacy] = await Promise.all([
      db.collection("companies").where("inGraph.status", "==", "PUBLISHED").get(),
      db.collection("companies").where("aiGraph.status", "==", "PUBLISHED").get(),
    ]);
    const docs = [...new Map([...legacy.docs, ...current.docs].map(doc => [doc.id, doc])).values()].filter(doc => {
      const data = doc.data();
      return data.listingStatus === "PRIVATE" && (data.inGraph ?? data.aiGraph)?.status === "PUBLISHED";
    });
    counts.companies = docs.length;
    for (const doc of docs) {
      try {
        if (Date.now() > deadline) throw Error("Worker time budget exhausted");
        const result = await checkPrivateValuation(doc.id);
        if (!dryRun) await db.runTransaction(async tx => {
          const fresh = (await tx.get(doc.ref)).data();
          if (fresh?.listingStatus !== "PRIVATE" || (fresh.inGraph ?? fresh.aiGraph)?.status !== "PUBLISHED") throw Error("Company eligibility changed during the check");
          // Replace this field only. Never modify public market caps, company
          // identity, or reset valuationDate on a successful recheck.
          tx.update(doc.ref, { privateValuationCheck: result });
        });
        counts[result.status]++;
        log.emit(result.status === "verified" ? "INFO" : "WARNING", "company_checked", { company: doc.id, ...result });
      } catch (error) {
        counts.failed++;
        log.emit("ERROR", "company_failed", { company: doc.id, error: maintenanceError(error) });
      }
    }
    if (!dryRun) await lease.set({ lastRunAt: new Date().toISOString(), result: counts }, { merge: true });
    log.emit(counts.failed ? "ERROR" : counts.review_required || counts.stale || counts.unsupported ? "WARNING" : "INFO", "run_completed", counts);
    if (counts.failed) throw Error("Some private valuation sources could not be checked; see Errors & warnings");
  } finally { if (!dryRun) await releaseMaintenanceLease(lease, log.runId); }
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
