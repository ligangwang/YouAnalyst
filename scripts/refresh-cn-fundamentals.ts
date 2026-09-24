import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadKnowledgeGraph } from "../src/lib/knowledge-graph/service";
import { cnMapCompanies, CN_COMPANY_ID } from "../src/lib/knowledge-graph/cn-companies";
import { FUNDAMENTALS_COLLECTION } from "../src/lib/fundamentals/service";
import { CN_WORKER_DOC, refreshCnFundamentals } from "../src/lib/fundamentals/cn-refresh";
import { createCnRequester, createCnSources } from "../src/lib/fundamentals/cn-sources";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../src/lib/maintenance-lease";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";

// Usage: refresh-cn-fundamentals [--dry-run] [--companies=XSHG:600584,XSHE:000063]
// --dry-run fetches and prints share counts, prices, FX and market caps without any Firestore write.
const dryRun = process.argv.includes("--dry-run");
const subset = process.argv.find(arg => arg.startsWith("--companies="))?.slice("--companies=".length).split(",").map(v => v.trim().toUpperCase()).filter(Boolean);
const log = createMaintenanceLog("refresh-cn-fundamentals", { dryRun });

async function main() {
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  if (subset?.some(id => !CN_COMPANY_ID.test(id))) throw new Error("--companies accepts XSHG:6xxxxx or XSHE:0xxxxx/3xxxxx IDs");
  if (subset && !dryRun) throw new Error("--companies is only supported with --dry-run");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  const lease = db.collection(FUNDAMENTALS_COLLECTION).doc(CN_WORKER_DOC);
  if (dryRun) {
    // Read-only: do not take the lease, but do not overlap a real run either.
    if (Number((await lease.get()).get("leaseExpiresAtMs")) > Date.now()) throw new Error("A real A-share fundamentals run holds the lease; retry the dry run later");
  } else if (!await acquireMaintenanceLease(lease, log.runId, Date.now(), cloudRunTaskAttempt())) {
    throw new Error("Another A-share fundamentals worker holds the lease");
  }
  const deadline = Date.now() + 18 * 60_000;
  try {
    log.stage("select_companies");
    const mapCompanies = cnMapCompanies(await loadKnowledgeGraph());
    if (!mapCompanies.length) throw new Error("No A-share map companies found; refusing an incomplete run");
    const companies = subset ?? mapCompanies;
    log.emit("INFO", "companies_selected", { companies: companies.length, mapCompanies: mapCompanies.length, subset: Boolean(subset) });
    const requester = createCnRequester({ context: { runId: log.runId, job: "refresh-cn-fundamentals" } });
    const result = await refreshCnFundamentals({ db, log, sources: createCnSources(requester), companies, deadline, dryRun,
      blockedHosts: requester.blockedHosts, print: line => console.log(line) });
    if (!dryRun) await lease.set({ lastRunAt: new Date().toISOString(), result }, { merge: true });
    // Like the SEC job, any provider failure marks the run failed (old data is kept).
    // Explicitly unavailable data (e.g. a pending corporate action) does not.
    const failed = result.failed || result.actions.failed || result.shares.failed || result.marketCaps.failed || result.sourcesIncomplete;
    log.emit(failed ? "ERROR" : "INFO", "run_completed", result);
    if (failed) throw new Error("A-share fundamentals refresh failed or is incomplete; see run summary");
  } finally {
    if (!dryRun) await releaseMaintenanceLease(lease, log.runId);
  }
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
