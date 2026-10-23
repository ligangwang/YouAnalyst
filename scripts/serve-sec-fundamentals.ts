import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { processFundamentalsBatch } from "../src/lib/fundamentals/pubsub-batch";
import { fundamentalsRequestForFiling, parseFundamentalsRequest, publishFundamentalsMessage } from "../src/lib/fundamentals/pubsub";
import {secCacheOwner,withSecDocumentProcessing} from '../src/lib/sec-filings/document-cache';
import {secFilingDocumentUrl} from '../src/lib/sec-filings/download-worker';

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || !process.env.FUNDAMENTALS_RESULT_TOPIC
  || !process.env.FUNDAMENTALS_SUBSCRIPTION) throw new Error("Missing fundamentals subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: process.env.FUNDAMENTALS_SUBSCRIPTION,
  job: "sec-fundamentals-batch", parse: parseFundamentalsRequest,
  additionalSubscriptions: process.env.SEC_FILINGS_FUNDAMENTALS_SUBSCRIPTION
    ? [{ subscription: process.env.SEC_FILINGS_FUNDAMENTALS_SUBSCRIPTION, parse: fundamentalsRequestForFiling }] : [],
  process: (request, log) => {
    const work=()=>processFundamentalsBatch(request,db,log,event=>publishFundamentalsMessage(process.env.FUNDAMENTALS_RESULT_TOPIC!,event));
    return request.filing?withSecDocumentProcessing(secCacheOwner('fundamentals',request.filing.eventId),secFilingDocumentUrl(request.filing),work,result=>result.failed===0&&result.remaining===0):work();
  },
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
