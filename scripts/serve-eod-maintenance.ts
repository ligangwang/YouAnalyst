import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { parseEodMessage, processEodCompanyMessage } from "../src/lib/predictions/eod-company-queue";
if (!process.env.GCP_PROJECT_ID || !process.env.EOD_SUBSCRIPTION) throw Error("Missing EOD subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.EOD_SUBSCRIPTION,
  job: "eod-maintenance-batch", parse: parseEodMessage,
  process: (request, log) => processEodCompanyMessage(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
