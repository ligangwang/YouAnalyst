import { createServer } from "node:http";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createMaintenanceLog, maintenanceError } from "../src/lib/maintenance-log";
import { processFundamentalsBatch } from "../src/lib/fundamentals/pubsub-batch";
import { parseFundamentalsRequest, publishFundamentalsMessage } from "../src/lib/fundamentals/pubsub";

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || !process.env.FUNDAMENTALS_RESULT_TOPIC
  || !process.env.FUNDAMENTALS_SUBSCRIPTION) throw new Error("Missing fundamentals subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
// Cloud Run IAM authenticates Pub/Sub's OIDC token before requests reach this
// private service. Never deploy this service with unauthenticated access.
createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
  if (req.method !== "POST" || req.url !== "/pubsub") { res.writeHead(404); res.end(); return; }
  const log = createMaintenanceLog("sec-fundamentals-batch", { mode: "pubsub" });
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64_000) throw new Error("Pub/Sub envelope too large");
      chunks.push(Buffer.from(chunk));
    }
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const subscription = `projects/${process.env.GCP_PROJECT_ID}/subscriptions/${process.env.FUNDAMENTALS_SUBSCRIPTION}`;
    if (envelope.subscription !== subscription || typeof envelope.message?.data !== "string") throw new Error("Unexpected Pub/Sub envelope");
    const request = parseFundamentalsRequest(JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")));
    log.emit("INFO", "run_started", { batchId: request.batchId, requested: request.companyIds.length });
    const result = await processFundamentalsBatch(request, db, log,
      event => publishFundamentalsMessage(process.env.FUNDAMENTALS_RESULT_TOPIC!, event));
    log.emit("INFO", "run_completed", { batchId: request.batchId, ...result });
    res.writeHead(204); res.end();
  } catch (error) {
    log.emit("ERROR", "run_failed", { error: maintenanceError(error) });
    // Non-2xx keeps the whole message unacknowledged; durable progress skips
    // completed companies. Poison messages eventually reach the dead-letter topic.
    res.writeHead(503); res.end("Batch requires retry");
  }
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
