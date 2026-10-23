import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { parseCompanyGraphManualJob, parseCompanyGraphFiling, type CompanyGraphJob } from "../src/lib/company-graph/pubsub";
import { processCompanyGraphJob } from "../src/lib/company-graph/queue-worker";
import {secCacheOwner,withSecDocumentProcessing} from '../src/lib/sec-filings/document-cache';
import {secFilingDocumentUrl} from '../src/lib/sec-filings/download-worker';

if (!process.env.GCP_PROJECT_ID || !process.env.COMPANY_GRAPH_SUBSCRIPTION || !process.env.SEC_USER_AGENT) {
  throw new Error("Missing company graph subscriber configuration");
}
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber<CompanyGraphJob>({ project: process.env.GCP_PROJECT_ID, subscription: process.env.COMPANY_GRAPH_SUBSCRIPTION,
  job: "company-graph-batch", parse: parseCompanyGraphManualJob,
  additionalSubscriptions: process.env.COMPANY_GRAPH_FILINGS_SUBSCRIPTION
    ? [{ subscription: process.env.COMPANY_GRAPH_FILINGS_SUBSCRIPTION, parse: parseCompanyGraphFiling }] : [],
  process: (request, log) => {
    if(request.type!=='sec.filing.discovered'||request.form!=='10-K')return processCompanyGraphJob(request,db,log);
    let complete=false;
    return withSecDocumentProcessing(secCacheOwner('graph',request.eventId),secFilingDocumentUrl(request),async()=>{
      const result=await processCompanyGraphJob(request,db,log);
      complete=(await db.collection('company_research_runs').doc(`_graph_filing_receipt_${request.eventId}`).get()).get('completed')===true;
      return result;
    },()=>complete);
  },
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
