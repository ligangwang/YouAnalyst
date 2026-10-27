import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { processCnRequest, parseCnRequest } from "../src/lib/fundamentals/cn-pubsub";
import { createSerialAdmission } from "../src/lib/serial-admission";

if (!process.env.GCP_PROJECT_ID
  || !process.env.CN_FUNDAMENTALS_SUBSCRIPTION) throw new Error("Missing A-share subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
const admit = createSerialAdmission({ maxWaiting: 9, waitMs: 90_000 });
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.CN_FUNDAMENTALS_SUBSCRIPTION,
  job: "cn-fundamentals-check", parse: parseCnRequest,
  process: (request, log, signal) => admit(() => processCnRequest(request, db, log), signal),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
