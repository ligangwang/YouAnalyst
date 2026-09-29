import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processFundamentalsBatch } from "../src/lib/fundamentals/pubsub-batch";
import { parseFundamentalsRequest, publishFundamentalsMessage } from "../src/lib/fundamentals/pubsub";

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || !process.env.FUNDAMENTALS_RESULT_TOPIC
  || !process.env.FUNDAMENTALS_SUBSCRIPTION) throw new Error("Missing fundamentals subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.FUNDAMENTALS_SUBSCRIPTION,
  job: "sec-fundamentals-batch", parse: parseFundamentalsRequest,
  process: (request, log) => processFundamentalsBatch(request, db, log, event => publishFundamentalsMessage(process.env.FUNDAMENTALS_RESULT_TOPIC!, event)),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
