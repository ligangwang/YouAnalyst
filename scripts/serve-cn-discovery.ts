import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {createJobSubscriber} from '../src/lib/job-pubsub-server';
import {CN_DISCOVERY_SUBSCRIPTION,parseCnDiscoveryTask,processCnDiscoveryTask} from '../src/lib/events/cn-discovery-queue';
import {createSerialAdmission} from '../src/lib/serial-admission';
if(!process.env.GCP_PROJECT_ID||process.env.CN_DISCOVERY_SUBSCRIPTION!==CN_DISCOVERY_SUBSCRIPTION)throw new Error('Invalid A-share discovery subscriber configuration');
for(const flag of ['CN_DISCOVERY_QUEUE_ENABLED','EARNINGS_COLLECTION_ENABLED'])if(!['0','1'].includes(process.env[flag]??'0'))throw new Error(`Invalid ${flag}`);
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const db=getFirestore();
const admit=createSerialAdmission({maxWaiting:2,waitMs:90_000});
createJobSubscriber({project:process.env.GCP_PROJECT_ID,subscription:CN_DISCOVERY_SUBSCRIPTION,job:'cn-company-discovery',parse:parseCnDiscoveryTask,
  process:(task,log,signal)=>admit(()=>processCnDiscoveryTask(task,db,log,{enabled:process.env.CN_DISCOVERY_QUEUE_ENABLED==='1',earningsEnabled:process.env.EARNINGS_COLLECTION_ENABLED==='1'}),signal),
}).listen(Number(process.env.PORT||8080),'0.0.0.0');
