import {readCollectionCompanies} from '../src/lib/company-support/collection-reader';
import {supportedCompanyUniverse} from '../src/lib/company-support/model';
import { closeLocalCaches } from '../src/lib/local-cache/watch';
import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {collectCnMapDisclosures} from '../src/lib/events/cn-disclosures';
import {createCnEarningsRequester} from '../src/lib/earnings/live-cn';
import {createEarningsRequestGate} from '../src/lib/earnings/live-transport';
import {randomUUID} from 'node:crypto';
import {translateCollectedHeadlines} from '../src/lib/intelligence/collectors/headline-translations';
import {autoPublishPendingRelationships} from '../src/lib/relationship-review/automatic';
import {runScheduledClassifications} from '../src/lib/events/classification-worker';
import {publishJobMessage} from '../src/lib/job-pubsub';
import {CN_DISCOVERY_TOPIC,cnDiscoveryState,publishCnDiscoveryTasks} from '../src/lib/events/cn-discovery-queue';
import {mapListedCompanies} from '../src/lib/events/disclosures';
import {NEWS_ENRICHMENT_TOPIC,readArticleCandidates,publishArticleTasks} from '../src/lib/intelligence/collectors/article-queue';

async function main(){
  const args=process.argv.slice(2);
  const cnOnly=args.includes('--cn-announcements-only');
  const skipCn=args.includes('--skip-cn-announcements');
  if((cnOnly&&skipCn)||args.some(arg=>!['--apply','--cn-announcements-only','--skip-cn-announcements'].includes(arg))){
    throw Error('Usage: collect-intelligence-news [--apply] [--cn-announcements-only|--skip-cn-announcements]');
  }
  if(args.includes('--apply')&&process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED!=='1')throw Error('Disclosure collector is disabled');
  if(!process.env.GCP_PROJECT_ID)throw new Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  // Collection needs enrolled companies, not graph edges, neighbors or valuations.
  const db=getFirestore(),graph=supportedCompanyUniverse(await readCollectionCompanies(db));
  const mapped=new Set(graph.nodes.filter(n=>n.kind==='COMPANY').map(n=>n.id));
  if(!args.includes('--apply')){console.log(JSON.stringify({companies:mapped.size,apply:false}));return;}
  const deadline=Date.now()+18*60_000;
  const classifications=cnOnly?undefined:await runScheduledClassifications(db,{enrichInsiders:Boolean(process.env.SEC_USER_AGENT),deadline:Date.now()+90_000,maxPages:5});
  const enrichmentTopic=process.env.NEWS_ENRICHMENT_REQUEST_TOPIC;
  if(enrichmentTopic&&enrichmentTopic!==NEWS_ENRICHMENT_TOPIC)throw new Error('Unexpected article enrichment queue');
  const relationships=cnOnly?undefined:await autoPublishPendingRelationships(db,Math.min(deadline-6*60_000,Date.now()+60_000));
  const gate=createEarningsRequestGate(db),transport=createCnEarningsRequester({beforeRequest:gate.beforeRequest,onBlocked:gate.onBlocked});
  const cnTopic=process.env.CN_DISCOVERY_REQUEST_TOPIC;
  if(cnTopic&&cnTopic!==CN_DISCOVERY_TOPIC)throw new Error('Unexpected A-share discovery destination');
  const exchangeDeadline=Math.min(deadline-4*60_000,Date.now()+6*60_000),earningsEnabled=process.env.EARNINGS_COLLECTION_ENABLED==='1';
  const exchange=skipCn?undefined:cnTopic?await publishCnDiscoveryTasks(mapListedCompanies(graph).filter(n=>n.market==='CN_A').map(n=>n.id),'announcements',task=>publishJobMessage(cnTopic,task),{
    execution:process.env.CLOUD_RUN_EXECUTION??randomUUID(),deadline:exchangeDeadline,earningsEnabled,readState:(id,mode)=>cnDiscoveryState(db,id,mode),
  }):await collectCnMapDisclosures(db,graph,transport.request,{deadline:exchangeDeadline,runId:randomUUID(),earningsEnabled});
  if(cnOnly){
    console.log(JSON.stringify({job:'collect-cn-announcements',exchange}));
    if(exchange&&'failed' in exchange&&exchange.failed)process.exitCode=1;
    return;
  }
  const enrichment=enrichmentTopic?await publishArticleTasks(await readArticleCandidates(db,mapped,false,Date.now(),true),task=>publishJobMessage(enrichmentTopic,task),{execution:process.env.CLOUD_RUN_EXECUTION??randomUUID(),deadline}):undefined;
  const headlines=enrichmentTopic?{mode:'pubsub'}:await translateCollectedHeadlines(db,mapped,{deadline:Math.min(deadline-2*60_000,Date.now()+150_000),disclosuresOnly:true});
  console.log(JSON.stringify({job:'collect-intelligence-news',enrichment,exchange,headlines,classifications,relationships}));
  if(enrichment?.failed)process.exitCode=1;
  if(exchange&&'failed' in exchange&&exchange.failed)process.exitCode=1;
}
main().finally(closeLocalCaches).catch(error=>{console.error(error instanceof Error?error.message:'Collector failed');process.exitCode=1;});
