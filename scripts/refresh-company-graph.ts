import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { publishQueuedCompanyGraphRequests, verifyCompanyGraphDelivery } from "../src/lib/company-graph/queue-worker";

import { parseCompanyGraphPublisherArgs } from "../src/lib/company-graph/cli";

const log = createMaintenanceLog("refresh-company-graph");
async function main() {
  const { preview, verify, limit } = parseCompanyGraphPublisherArgs(process.argv.slice(2));
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore(), topic = process.env.COMPANY_GRAPH_REQUEST_TOPIC;
  if (verify) {
    if (!topic) throw new Error("COMPANY_GRAPH_REQUEST_TOPIC is required for verification");
    const result = await verifyCompanyGraphDelivery(db, request => publishJobMessage(topic, request));
    log.emit("INFO", "run_completed", result); return;
  }
  if (!preview && !topic) throw new Error("COMPANY_GRAPH_REQUEST_TOPIC is required to apply");
  const result = await publishQueuedCompanyGraphRequests({ limit, preview }, { db });
  log.emit(result.failed ? "ERROR" : "INFO", "run_completed", result);
  if (result.failed) throw new Error("Company graph request publication needs retry");
}
main().catch(error => { log.emit("ERROR", "run_failed", { error: maintenanceError(error) }); process.exitCode = 1; });
