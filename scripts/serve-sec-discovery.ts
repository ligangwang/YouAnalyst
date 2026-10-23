import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {createJobSubscriber} from '../src/lib/job-pubsub-server';
import {SEC_DISCOVERY_SUBSCRIPTION,parseSecDiscoveryTask,processSecDiscoveryTask} from '../src/lib/sec-filings/discovery-queue';
import {discoverSecCompany} from '../src/lib/sec-filings/discovery';
if(!process.env.GCP_PROJECT_ID||process.env.SEC_DISCOVERY_SUBSCRIPTION!==SEC_DISCOVERY_SUBSCRIPTION)throw new Error('Invalid SEC discovery subscriber configuration');
if(!['0','1'].includes(process.env.SEC_DISCOVERY_QUEUE_ENABLED??'0'))throw new Error('Invalid SEC discovery flag');
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const db=getFirestore();
createJobSubscriber({project:process.env.GCP_PROJECT_ID,subscription:SEC_DISCOVERY_SUBSCRIPTION,job:'sec-company-discovery',parse:parseSecDiscoveryTask,
  process:task=>processSecDiscoveryTask(task,db,{enabled:process.env.SEC_DISCOVERY_QUEUE_ENABLED==='1',run:ticker=>discoverSecCompany(db,ticker)})
}).listen(Number(process.env.PORT||8080),'0.0.0.0');
