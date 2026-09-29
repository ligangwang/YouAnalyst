import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processDirectoryRequest, parseDirectoryRequest } from "../src/lib/industry-research/directory-pubsub";

if (!process.env.GCP_PROJECT_ID
  || !process.env.DIRECTORY_SUBSCRIPTION) throw new Error("Missing directory subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.DIRECTORY_SUBSCRIPTION,
  job: "cni-directory-import", parse: parseDirectoryRequest,
  process: (request, log) => processDirectoryRequest(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
