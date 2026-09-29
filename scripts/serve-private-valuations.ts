import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processPrivateValuationCheck, parsePrivateValuationRequest } from "../src/lib/fundamentals/private-valuation-pubsub";

if (!process.env.GCP_PROJECT_ID
  || !process.env.PRIVATE_VALUATIONS_SUBSCRIPTION) throw new Error("Missing private valuation subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.PRIVATE_VALUATIONS_SUBSCRIPTION,
  job: "private-valuation-check", parse: parsePrivateValuationRequest,
  process: (request, log) => processPrivateValuationCheck(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
