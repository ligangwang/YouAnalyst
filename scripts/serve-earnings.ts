import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { publishJobMessage } from "../src/lib/job-pubsub";
import { EARNINGS_SUBSCRIPTION, EARNINGS_TOPIC, parseEarningsJob } from "../src/lib/earnings/live-event";
import { processEarningsJob } from "../src/lib/earnings/live-worker";
import { createEarningsDownloader } from "../src/lib/earnings/live-transport";

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || process.env.EARNINGS_SUBSCRIPTION !== EARNINGS_SUBSCRIPTION) throw new Error("Missing or invalid earnings subscriber configuration");
for (const flag of ["EARNINGS_PROCESSING_ENABLED", "EARNINGS_CANARY_ONLY"]) if (!["0", "1"].includes(process.env[flag] ?? "0")) throw new Error(`Invalid ${flag}`);
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: EARNINGS_SUBSCRIPTION, job: "earnings-source", parse: parseEarningsJob,
  process: (request, log) => processEarningsJob(request, db, log, {
    enabled: process.env.EARNINGS_PROCESSING_ENABLED === "1",
    canaryOnly: process.env.EARNINGS_CANARY_ONLY === "1",
    download: createEarningsDownloader(db, { userAgent: process.env.SEC_USER_AGENT!, signal: AbortSignal.timeout(7 * 60_000) }),
    publish: event => publishJobMessage(EARNINGS_TOPIC, event),
  }),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
