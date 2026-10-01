import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadKnowledgeGraph } from "../src/lib/knowledge-graph/service";
import { usMapTickers } from "../src/lib/knowledge-graph/us-companies";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { collectSecFilings, inspectSecFilingCollection } from "../src/lib/sec-filings/collector";
import { SEC_FILINGS_TOPIC } from "../src/lib/sec-filings/event";
import { createSecFilingsSource } from "../src/lib/sec-filings/source";
import { baselineSecFilings, inspectSecBaseline } from "../src/lib/sec-filings/baseline";
import { parseSecCollectorArgs } from "../src/lib/sec-filings/cli";

const log = createMaintenanceLog("collect-sec-filings");
async function main() {
  const { apply, companyId, baselineOnly, maxCompanies } = parseSecCollectorArgs(process.argv.slice(2));
  // Both the scheduler and this explicit application switch start disabled.
  // Running the CLI without --apply is safe even with production credentials.
  if (apply && process.env.SEC_FILINGS_COLLECTOR_ENABLED !== "1") {
    log.emit("INFO", "run_completed", { status: "paused", reason: "SEC_FILINGS_COLLECTOR_ENABLED is not 1" });
    return;
  }
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
  // This branch never loads the global graph or reaches the outbox publisher.
  if (baselineOnly && companyId) {
    if (!apply) {
      log.emit("INFO", "run_completed", await inspectSecBaseline(db, companyId));
      return;
    }
    if (!process.env.SEC_USER_AGENT?.trim()) throw new Error("SEC_USER_AGENT is required");
    const timeoutMs = 12 * 60_000;
    const result = await baselineSecFilings(db, companyId, log, {
      source: createSecFilingsSource(process.env.SEC_USER_AGENT, AbortSignal.timeout(timeoutMs)),
      deadline: Date.now() + timeoutMs,
    });
    log.emit(result.status === "partial" ? "WARNING" : "INFO", "run_completed", result);
    if (result.status === "partial") throw new Error("Initial baseline incomplete; retry only the frozen snapshot");
    return;
  }
  const companyIds = usMapTickers(await loadKnowledgeGraph());
  if (!apply) {
    log.emit("INFO", "run_completed", { ...await inspectSecFilingCollection(db, companyIds), maxCompaniesPerRun: maxCompanies });
    return;
  }
  if (!process.env.SEC_USER_AGENT?.trim()) throw new Error("SEC_USER_AGENT is required");
  const timeoutMs = 12 * 60_000;
  const result = await collectSecFilings(db, companyIds, log, {
    source: createSecFilingsSource(process.env.SEC_USER_AGENT, AbortSignal.timeout(timeoutMs)),
    publish: event => publishJobMessage(process.env.SEC_FILINGS_TOPIC || SEC_FILINGS_TOPIC, event),
    deadline: Date.now() + timeoutMs,
    maxCompanies,
  });
  log.emit(result.failed ? "ERROR" : "INFO", "run_completed", result);
  if (result.failed) throw new Error("SEC filing collection had failed companies; durable progress retained");
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
