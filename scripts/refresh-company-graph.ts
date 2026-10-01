import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { publishQueuedCompanyGraphRequests, verifyCompanyGraphDelivery } from "../src/lib/company-graph/queue-worker";

import { parseCompanyGraphPublisherArgs } from "../src/lib/company-graph/cli";
import { verifyLiveCompanyGraph } from "../src/lib/company-graph/live-verification";
import { SEC_FILINGS_TOPIC } from "../src/lib/sec-filings/event";

const log = createMaintenanceLog("refresh-company-graph");
async function main() {
  const { preview, verify, verifyLive, limit } = parseCompanyGraphPublisherArgs(process.argv.slice(2));
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required");
  initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
  const db = getFirestore(), topic = process.env.COMPANY_GRAPH_REQUEST_TOPIC;
  if (verifyLive) {
    if (topic !== "company-graph-requests" || !process.env.GIT_SHA || process.env.GIT_SHA !== process.env.SEC_GRAPH_RELEASE_SHA) {
      throw new Error("Live verification requires the deployed release and existing graph topic");
    }
    const result = await verifyLiveCompanyGraph(db, process.env.SEC_GRAPH_ACTIVATION_TREE ?? "", {
      publishGraph: request => publishJobMessage(topic, request),
      publishFiling: event => publishJobMessage(SEC_FILINGS_TOPIC, event),
      onPreflight: counts => log.emit("INFO", "live_activation_preflight", counts),
    });
    log.emit("INFO", "live_activation_verified", result); return;
  }
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
