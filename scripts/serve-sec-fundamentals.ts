import { createJobSubscriber } from "../src/lib/job-pubsub-server";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "../src/lib/firebase/firestore";
import { processFundamentalsBatch } from "../src/lib/fundamentals/pubsub-batch";
import { fundamentalsRequestForFiling, parseFundamentalsRequest, publishFundamentalsMessage } from "../src/lib/fundamentals/pubsub";
import {secCacheOwner,withSecDocumentProcessing} from '../src/lib/sec-filings/document-cache';
import {secFilingDocumentUrl} from '../src/lib/sec-filings/download-worker';
import {parseMarketCapMessage,processMarketCapMessage,type MarketCapMessage} from '../src/lib/fundamentals/market-cap-queue';
import type {FundamentalsRequest} from '../src/lib/fundamentals/pubsub';
import {parseSeedMessage,processSeedMessage,type SeedMessage} from '../src/lib/fundamentals/seed-queue';

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || !process.env.FUNDAMENTALS_RESULT_TOPIC
  || !process.env.FUNDAMENTALS_SUBSCRIPTION) throw new Error("Missing fundamentals subscriber configuration");
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
createJobSubscriber<FundamentalsRequest|MarketCapMessage|SeedMessage>({ project: process.env.GCP_PROJECT_ID, subscription: process.env.FUNDAMENTALS_SUBSCRIPTION,
  job: "sec-fundamentals-batch", parse: value => {
    const v=value as {type?:string;kind?:string};
    if(v?.type?.startsWith('fundamentals.seed')||v?.type==='instruments.sync.requested'||v?.kind==='us-fundamentals-seed'||v?.kind==='instrument-sync')return parseSeedMessage(value);
    return ['company.work.requested','market-cap.refresh.requested'].includes(String(v?.type))?parseMarketCapMessage(value):parseFundamentalsRequest(value);
  },
  additionalSubscriptions: process.env.SEC_FILINGS_FUNDAMENTALS_SUBSCRIPTION
    ? [{ subscription: process.env.SEC_FILINGS_FUNDAMENTALS_SUBSCRIPTION, parse: fundamentalsRequestForFiling }] : [],
  process: (request, log) => {
    if(request.type.startsWith('fundamentals.seed')||request.type==='instruments.sync.requested'||('kind'in request&&['us-fundamentals-seed','instrument-sync'].includes(request.kind)))return processSeedMessage(request as SeedMessage,db,log);
    if(request.type!=='fundamentals.refresh.requested')return processMarketCapMessage(request as MarketCapMessage,db,log);
    const work=()=>processFundamentalsBatch(request,db,log,event=>publishFundamentalsMessage(process.env.FUNDAMENTALS_RESULT_TOPIC!,event));
    return request.filing?withSecDocumentProcessing(secCacheOwner('fundamentals',request.filing.eventId),secFilingDocumentUrl(request.filing),work,result=>result.failed===0&&result.remaining===0):work();
  },
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
