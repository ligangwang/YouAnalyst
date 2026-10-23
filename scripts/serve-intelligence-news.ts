import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {createJobSubscriber} from '../src/lib/job-pubsub-server';
import {NEWS_SUBSCRIPTION,parseNewsRequest,processNewsRequest} from '../src/lib/intelligence/collectors/pubsub';

if(!process.env.GCP_PROJECT_ID||process.env.NEWS_SOURCE_SUBSCRIPTION!==NEWS_SUBSCRIPTION)throw new Error('Invalid news subscriber configuration');
if(!['0','1'].includes(process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED??'0'))throw new Error('Invalid news collection flag');
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const db=getFirestore();
createJobSubscriber({project:process.env.GCP_PROJECT_ID,subscription:NEWS_SUBSCRIPTION,job:'news-source',parse:parseNewsRequest,
  process:request=>processNewsRequest(request,db,{enabled:process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED==='1'}),
}).listen(Number(process.env.PORT||8080),'0.0.0.0');
