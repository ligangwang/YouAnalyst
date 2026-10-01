import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { parseCompanyGraphManualJob, parseCompanyGraphFiling, type CompanyGraphJob } from "../src/lib/company-graph/pubsub";
import { processCompanyGraphJob } from "../src/lib/company-graph/queue-worker";

if (!process.env.GCP_PROJECT_ID || !process.env.COMPANY_GRAPH_SUBSCRIPTION || !process.env.SEC_USER_AGENT) {
  throw new Error("Missing company graph subscriber configuration");
}
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber<CompanyGraphJob>({ project: process.env.GCP_PROJECT_ID, subscription: process.env.COMPANY_GRAPH_SUBSCRIPTION,
  job: "company-graph-batch", parse: parseCompanyGraphManualJob,
  additionalSubscriptions: process.env.COMPANY_GRAPH_FILINGS_SUBSCRIPTION
    ? [{ subscription: process.env.COMPANY_GRAPH_FILINGS_SUBSCRIPTION, parse: parseCompanyGraphFiling }] : [],
  process: (request, log) => processCompanyGraphJob(request, db, log),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
