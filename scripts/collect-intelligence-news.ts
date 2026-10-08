import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {loadNewsSources} from '../src/lib/intelligence/collectors/source-service';
import {fetchNews} from '../src/lib/intelligence/collectors/news';
import {collectNewsSources,NEWS_HISTORY_START} from '../src/lib/intelligence/collectors/collector';
import {firestoreNewsStore} from '../src/lib/intelligence/collectors/store';
import {loadCollectionUniverse} from '../src/lib/company-themes/service';
import {collectCnMapDisclosures} from '../src/lib/events/cn-disclosures';
import {createCnEarningsRequester} from '../src/lib/earnings/live-cn';
import {createEarningsRequestGate} from '../src/lib/earnings/live-transport';
import {randomUUID} from 'node:crypto';
import {translateCollectedHeadlines} from '../src/lib/intelligence/collectors/headline-translations';
import {collectCalendarSchedules} from '../src/lib/calendar/worker';

async function main(){
  const args=process.argv.slice(2);if(args.some(arg=>!['--apply','--revalidate-calendar'].includes(arg)))throw new Error('Usage: collect-intelligence-news [--apply] [--revalidate-calendar]');
  if(args.includes('--revalidate-calendar') && !args.includes('--apply'))throw new Error('Cached calendar revalidation requires --apply');
  if(args.includes('--apply')&&process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED!=='1')throw new Error('News collector is disabled');
  if(!process.env.GCP_PROJECT_ID)throw new Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db=getFirestore(),graph=await loadCollectionUniverse(db),mapped=new Set(graph.nodes.filter(n=>n.kind==='COMPANY').map(n=>n.id)),sources=(await loadNewsSources(db)).filter(source=>mapped.has(source.companyId));
  if(!args.includes('--apply')){
    // Read the production registry, but never write events or checkpoints.
    for(const source of sources){try{
      const response=await fetchNews(source);
      console.log(JSON.stringify({sourceId:source.id,companyId:source.companyId,historyStart:NEWS_HISTORY_START,...(response.status==='modified'?{items:response.page.items.length,eligibleHistory:response.page.items.filter(item=>item.publication_date&&item.publication_date>=NEWS_HISTORY_START).length,invalid:response.page.invalid,truncated:response.page.truncated,sample:response.page.items.slice(0,3).map(item=>({title:item.title,url:item.url,published_at:item.published_at,publication_date:item.publication_date}))}:{unchanged:true})}));
    }catch(error){console.log(JSON.stringify({sourceId:source.id,error:error instanceof Error?error.message:'Collector failed'}));process.exitCode=1;}}
    return;
  }

  if(args.includes('--revalidate-calendar')){
    // Validate saved responses against unchanged original content. Never reserve
    // a new provider request, including when the source content has changed.
    const calendar=await collectCalendarSchedules(db,mapped,{deadline:Date.now()+18*60_000,revalidateCached:true});
    console.log(JSON.stringify({job:'revalidate-calendar',calendar}));return;
  }
  const deadline=Date.now()+18*60_000,newsDeadline=Date.now()+8*60_000;
  // Rotate the start hourly; slow publishers cannot starve later map companies.
  const start=Math.floor(Date.now()/3600000)%Math.max(1,sources.length);
  const results=await collectNewsSources([...sources.slice(start),...sources.slice(0,start)],firestoreNewsStore(db),undefined,undefined,{deadline:newsDeadline});
  const headlines=await translateCollectedHeadlines(db,mapped,{deadline:Math.min(deadline-4*60_000,Date.now()+150_000)});
  const gate=createEarningsRequestGate(db),transport=createCnEarningsRequester({beforeRequest:gate.beforeRequest,onBlocked:gate.onBlocked});
  const exchange=await collectCnMapDisclosures(db,graph,transport.request,{deadline:Math.min(deadline-4*60_000,Date.now()+6*60_000),runId:randomUUID(),earningsEnabled:process.env.EARNINGS_COLLECTION_ENABLED==='1'});
  const calendar=process.env.CALENDAR_EXTRACTION_ENABLED==='1'?await collectCalendarSchedules(db,mapped,{deadline}):{disabled:true};
  console.log(JSON.stringify({job:'collect-intelligence-news',results,exchange,calendar,headlines}));
  if(results.some(result=>result.status==='failed'))process.exitCode=1;
  if('failed' in exchange&&exchange.failed)process.exitCode=1;
  if('failed' in calendar&&calendar.failed)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Collector failed');process.exitCode=1;});
