import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {createJobSubscriber} from '../src/lib/job-pubsub-server';
import {NEWS_ENRICHMENT_SUBSCRIPTION,parseArticleTask,processArticleTask} from '../src/lib/intelligence/collectors/article-queue';
if(!process.env.GCP_PROJECT_ID||process.env.NEWS_ENRICHMENT_SUBSCRIPTION!==NEWS_ENRICHMENT_SUBSCRIPTION)throw new Error('Invalid news enrichment subscriber configuration');
for(const key of ['NEWS_ENRICHMENT_QUEUE_ENABLED','CALENDAR_EXTRACTION_ENABLED'])if(!['0','1'].includes(process.env[key]??'0'))throw new Error('Invalid article worker flag');
if(process.env.NEWS_ENRICHMENT_QUEUE_ENABLED==='1'&&!process.env.OPENAI_API_KEY)throw new Error('Reuse the approved existing AI key');
initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
const db=getFirestore();
createJobSubscriber({project:process.env.GCP_PROJECT_ID,subscription:NEWS_ENRICHMENT_SUBSCRIPTION,job:'news-article-enrichment',parse:parseArticleTask,
  process:task=>processArticleTask(task,db,{enabled:process.env.NEWS_ENRICHMENT_QUEUE_ENABLED==='1',calendarEnabled:process.env.CALENDAR_EXTRACTION_ENABLED==='1'})
}).listen(Number(process.env.PORT||8080),'0.0.0.0');
