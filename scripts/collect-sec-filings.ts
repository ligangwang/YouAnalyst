import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadKnowledgeGraph } from "../src/lib/knowledge-graph/service";
import { usMapTickers } from "../src/lib/knowledge-graph/us-companies";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { collectSecFilings, inspectSecFilingCollection } from "../src/lib/sec-filings/collector";
import { SEC_FILINGS_TOPIC } from "../src/lib/sec-filings/event";
import { createSecFilingsSource } from "../src/lib/sec-filings/source";

const log = createMaintenanceLog("collect-sec-filings");
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--dry-run"].includes(arg)) || (args.includes("--apply") && args.includes("--dry-run"))) {
    throw new Error("Usage: collect-sec-filings.ts [--dry-run | --apply]");
  }
  // Both the scheduler and this explicit application switch start disabled.
  // Running the CLI without --apply is safe even with production credentials.
  const apply = args.includes("--apply");
  const maxCompanies = Number(process.env.SEC_FILINGS_MAX_COMPANIES ?? "500");
  if (!Number.isSafeInteger(maxCompanies) || maxCompanies < 1 || maxCompanies > 500) {
    throw new Error("SEC_FILINGS_MAX_COMPANIES must be an integer from 1 to 500");
  }
  if (apply && process.env.SEC_FILINGS_COLLECTOR_ENABLED !== "1") {
    log.emit("INFO", "run_completed", { status: "paused", reason: "SEC_FILINGS_COLLECTOR_ENABLED is not 1" });
    return;
  }
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore();
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
