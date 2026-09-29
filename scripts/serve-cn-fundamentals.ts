import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processCnRequest, parseCnRequest } from "../src/lib/fundamentals/cn-pubsub";

if (!process.env.GCP_PROJECT_ID
  || !process.env.CN_FUNDAMENTALS_SUBSCRIPTION) throw new Error("Missing A-share subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.CN_FUNDAMENTALS_SUBSCRIPTION,
  job: "cn-fundamentals-check", parse: parseCnRequest,
  process: (request, log) => processCnRequest(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
