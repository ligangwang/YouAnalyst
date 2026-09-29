import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processTickerSync, parseTickerSyncRequest } from "../src/lib/tickers/pubsub";

if (!process.env.GCP_PROJECT_ID
  || !process.env.TICKER_SYNC_SUBSCRIPTION) throw new Error("Missing ticker sync subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.TICKER_SYNC_SUBSCRIPTION,
  job: "sync-tickers", parse: parseTickerSyncRequest,
  process: (request, log) => processTickerSync(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
