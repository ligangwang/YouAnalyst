import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {createJobSubscriber} from '../src/lib/job-pubsub-server';
import {publishJobMessage} from '../src/lib/job-pubsub';
import {parseSecIntakeJob,deliverSecIntake,SEC_DOWNLOAD_SUBSCRIPTION} from '../src/lib/sec-filings/download-worker';
import {getFirestore} from '../src/lib/firebase/firestore';
import {createSerialAdmission} from '../src/lib/serial-admission';

if(!process.env.GCP_PROJECT_ID||!process.env.SEC_DOCUMENT_CACHE_BUCKET||!process.env.SEC_USER_AGENT||process.env.SEC_DOWNLOAD_SUBSCRIPTION!==SEC_DOWNLOAD_SUBSCRIPTION)throw new Error('Invalid SEC download subscriber configuration');
if(!['0','1'].includes(process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED??'0'))throw new Error('Invalid SEC download flag');
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const db=getFirestore();
const admit=createSerialAdmission({maxWaiting:4,waitMs:90000});
createJobSubscriber({project:process.env.GCP_PROJECT_ID,subscription:SEC_DOWNLOAD_SUBSCRIPTION,job:'sec-filing-download',parse:parseSecIntakeJob,
  process:(request,_log,signal)=>admit(()=>deliverSecIntake(request,db,{enabled:process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED==='1',publish:publishJobMessage}),signal),
}).listen(Number(process.env.PORT||8080),'0.0.0.0');
