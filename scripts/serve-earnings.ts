import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { EARNINGS_SUBSCRIPTION, EARNINGS_PROBE_SUBSCRIPTION, parseEarningsJob, parseEarningsDeliveryProbe } from "../src/lib/earnings/live-event";
import { processEarningsJob } from "../src/lib/earnings/live-worker";
import { createEarningsDownloader } from "../src/lib/earnings/live-transport";
import {withDeliveryIssuer} from '../src/lib/earnings/delivery-issuer';
import {EARNINGS_SOURCES} from '../src/lib/earnings/live-store';
import {secCacheOwner,withSecDocumentProcessing} from '../src/lib/sec-filings/document-cache';
import {publishEarningsIntake} from '../src/lib/sec-filings/intake-routing';
import {createEarningsAdmission} from '../src/lib/earnings/live-admission';

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || process.env.EARNINGS_SUBSCRIPTION !== EARNINGS_SUBSCRIPTION) throw new Error("Missing or invalid earnings subscriber configuration");
for (const flag of ["EARNINGS_PROCESSING_ENABLED", "EARNINGS_CANARY_ONLY"]) if (!["0", "1"].includes(process.env[flag] ?? "0")) throw new Error(`Invalid ${flag}`);
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
const admit = createEarningsAdmission();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: EARNINGS_SUBSCRIPTION, job: "earnings-source", parse: parseEarningsJob,
  additionalSubscriptions: [{ subscription: EARNINGS_PROBE_SUBSCRIPTION, parse: parseEarningsDeliveryProbe }],
  process: (request, log, signal) => admit(request, async () => {
    const work=()=>processEarningsJob(request, db, log, {
    enabled: process.env.EARNINGS_PROCESSING_ENABLED === "1",
    canaryOnly: process.env.EARNINGS_CANARY_ONLY === "1",
    download: createEarningsDownloader(db, { userAgent: process.env.SEC_USER_AGENT!, signal: AbortSignal.timeout(7 * 60_000) }),
    publish: event => publishEarningsIntake(db,event),
    });
    if(request.type!=='earnings.source.discovered')return work();
    const ref=db.collection(EARNINGS_SOURCES).doc(request.sourceId),source=(await ref.get()).get('source');
    return withDeliveryIssuer(db,source?.companyId,async()=>{
      if(source?.provider!=='sec')return work();
      let complete=false;
      return withSecDocumentProcessing(secCacheOwner('earnings',request.batchId),source.url,async()=>{
        const result=await work();
        complete=['extracted','expanded','skipped'].includes((await ref.get()).get('status'));
        return result;
      },()=>complete);
    });
  }, signal),
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
