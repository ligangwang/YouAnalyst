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
import {pubsubPullTransport,runSerialPull} from '../src/lib/serial-pull';
import {createMaintenanceLog,maintenanceError,type MaintenanceLog} from '../src/lib/maintenance-log';
import type {EarningsJob} from '../src/lib/earnings/live-event';

if (!process.env.GCP_PROJECT_ID || !process.env.SEC_USER_AGENT || process.env.EARNINGS_SUBSCRIPTION !== EARNINGS_SUBSCRIPTION) throw new Error("Missing or invalid earnings subscriber configuration");
for (const flag of ["EARNINGS_PROCESSING_ENABLED", "EARNINGS_CANARY_ONLY"]) if (!["0", "1"].includes(process.env[flag] ?? "0")) throw new Error(`Invalid ${flag}`);
const deliveryMode=process.env.EARNINGS_DELIVERY_MODE??'push';
if(!['push','pull'].includes(deliveryMode))throw Error('Invalid earnings delivery mode');
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
const admit = createEarningsAdmission();
const processDelivery=(request:EarningsJob,log:MaintenanceLog,signal:AbortSignal)=>admit(request, async () => {
    const work=()=>processEarningsJob(request, db, log, {
    enabled: process.env.EARNINGS_PROCESSING_ENABLED === "1",
    canaryOnly: process.env.EARNINGS_CANARY_ONLY === "1",
    download: createEarningsDownloader(db, { userAgent: process.env.SEC_USER_AGENT!, signal: AbortSignal.any([signal,AbortSignal.timeout(7 * 60_000)]) }),
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
  }, signal);
const server=createJobSubscriber({ project: process.env.GCP_PROJECT_ID, subscription: EARNINGS_SUBSCRIPTION, job: "earnings-source", parse: parseEarningsJob,
  additionalSubscriptions: [{ subscription: EARNINGS_PROBE_SUBSCRIPTION, parse: parseEarningsDeliveryProbe }],
  process: processDelivery,
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
if(deliveryMode==='pull'){
  const shutdown=new AbortController();
  process.once('SIGTERM',()=>{shutdown.abort();server.close();});
  void runSerialPull({transport:pubsubPullTransport(process.env.GCP_PROJECT_ID,EARNINGS_SUBSCRIPTION),signal:shutdown.signal,
    async process(data,signal){
      const request=parseEarningsJob(data),log=createMaintenanceLog('earnings-source',{mode:'pull',batchId:request.batchId});
      log.emit('INFO','run_started');
      try{const result=await processDelivery(request,log,signal);log.emit('INFO','run_completed',result);}
      catch(error){log.emit('ERROR','run_failed',{error:maintenanceError(error)});throw error;}
    },
    error(stage,error){console.warn(JSON.stringify({event:'earnings_pull_error',stage,error:maintenanceError(error)}));},
  }).catch(error=>{console.error(error);process.exitCode=1;server.close();});
}
