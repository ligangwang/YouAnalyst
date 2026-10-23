import {loadPriceCache} from './price-cache';
import {changeCached,withCacheReadScope} from '../change-cache';
import {loadCachedFeed,type CachedFeed} from './feed-cache-store';
import { createHash } from 'node:crypto';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import { loadThemeGraph } from '../company-themes/graph-service';
import { type CompanyThemeId } from '../company-themes/model';
import { curatedEvents } from '../knowledge-graph/curated-events';
import { secCollectorFreshness } from '../sec-filings/store';
import { INTELLIGENCE_SOURCES, sourceDocumentsForEvents, intelligenceSession, secCollectorIsFresh, sourceChannel, type IntelligenceSnapshot } from './model';
import { mergeIntelligenceEvents, projectResearchIntelligence } from './project';
import { projectSecIntelligence } from './sec-events';
import { loadCollectedNews } from './collectors/projection';
import {projectDisclosures} from '../events/disclosure-projection';
import {attachPricePerformance} from './price-performance-service';
import {attachCalendarLinks} from '../calendar/intelligence-links';
import {groupCompanyAnnouncements} from './announcement-grouping';
import {companySearchRank,companySearchText,matchesCompanySearch} from '../knowledge-graph/model';

const LIMIT=10;
type ScheduleRefresh=(refresh:()=>Promise<void>)=>void;
const caches=new Map<CompanyThemeId,{value:IntelligenceSnapshot;key:string}>();
const requests=new Map<string,Promise<IntelligenceSnapshot>>();
// Retain the full period privately; company feeds reuse the same database read.
const periods=new WeakMap<IntelligenceSnapshot,IntelligenceSnapshot['events']>();
const companyRequests=new WeakMap<IntelligenceSnapshot,Map<string,Promise<IntelligenceSnapshot>>>();

/** The directory can render without waiting for source reads or price enrichment. */
export async function loadIntelligenceUniverse(now=new Date(),theme:CompanyThemeId='ai'):Promise<IntelligenceSnapshot>{
  const graph=await loadUniverseGraph(theme);
  return {theme,graph,graphVersion:createHash('sha256').update(JSON.stringify(graph)).digest('hex'),events:[],sourceDocuments:[],eventsPending:true,statisticsComplete:false,generatedAt:now.toISOString(),session:intelligenceSession(now),coverage:[],warnings:[],truncated:false,limit:LIMIT};
}

async function loadUniverseGraph(theme:CompanyThemeId){
  return process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'
    ?await fetch(`https://youanalyst.com/api/knowledge-graph?theme=${theme}`,{cache:'no-store',signal:AbortSignal.timeout(15_000)}).then(async response=>{if(!response.ok)throw new Error('Published graph unavailable');return await response.json() as Awaited<ReturnType<typeof loadKnowledgeGraph>>;})
    :await loadThemeGraph(theme);
}

export async function loadCompanyIntelligenceSnapshot(now=new Date(),theme:CompanyThemeId='ai',company='',query='',region='',scheduleRefresh?:ScheduleRefresh,before?:string):Promise<IntelligenceSnapshot>{
  const base=await loadIntelligenceSnapshot(now,theme,scheduleRefresh,before);
  const search=query.normalize('NFKC').trim().replace(/^\$/,'');
  if(!company&&!search&&region!=='US'&&region!=='CN_A')return base;
  const id=company.includes(':')?company.toUpperCase():`US:${company.toUpperCase()}`;
  const candidates=base.graph.nodes.filter(node=>node.kind==='COMPANY'&&(!region||(region==='US'?node.id.startsWith('US:'):region==='CN_A'?/^(XSHG:|XSHE:)/.test(node.id):true)));
  const exact=search?candidates.filter(node=>companySearchRank(node,search)===0):[];
  const ids=new Set(company?base.graph.nodes.filter(node=>node.kind==='COMPANY'&&node.id===id).map(node=>node.id):(exact.length?exact:candidates.filter(node=>matchesCompanySearch(companySearchText(base.graph,node),search))).map(node=>node.id));
  if(!ids.size)return {...base,events:[],eventReturns:{},truncated:false};
  const scopeKey=[...ids].sort().join('|');
  let requests=companyRequests.get(base);
  if(!requests){requests=new Map();companyRequests.set(base,requests);}
  const pending=requests.get(scopeKey);if(pending)return pending;
  const request=(async()=>{
    const matching=(periods.get(base)??base.events).filter(event=>event.companyIds.some(id=>ids.has(id)));
    const events=matching;
    let eventReturns:IntelligenceSnapshot['eventReturns']={};
    if(!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1')){
      // Enrich only companies in the selected/search scope; retain the shared graph.
      const graph={...base.graph,nodes:base.graph.nodes.filter(node=>ids.has(node.id))};
      eventReturns=(await attachPricePerformance(getAdminFirestore(),graph,events,now)).eventReturns;
    }
    return {...base,events,eventReturns,truncated:false};
  })();
  requests.set(scopeKey,request);
  try{return await request;}catch(error){requests.delete(scopeKey);throw error;}
}

/** Persistent day partitions are shared across users, processes and themes.
 * Time-dependent display/freshness is projected from change-cached source data.
 */
export async function loadIntelligenceSnapshot(now=new Date(),theme:CompanyThemeId='ai',_scheduleRefresh?:ScheduleRefresh,before?:string):Promise<IntelligenceSnapshot>{
  return withCacheReadScope(()=>buildIntelligenceSnapshot(now,theme,before));
}
async function buildIntelligenceSnapshot(now:Date,theme:CompanyThemeId,before?:string):Promise<IntelligenceSnapshot>{
  const session=intelligenceSession(now);
  const preview=process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1';
  let feed:CachedFeed|undefined,feedError:unknown;
  if(!preview)try{feed=await loadCachedFeed(getAdminFirestore(),now,before);}catch(error){feedError=error;}
  const priceView=preview?undefined:await loadPriceCache(getAdminFirestore());
  const graph=await loadUniverseGraph(theme);
  // Re-evaluate clock-dependent coverage on reads; source data has no timer expiry.
  const key=[session.date,feed?.revision??'unavailable',priceView?.version??'',createHash('sha256').update(JSON.stringify(graph)).digest('hex'),now.getTime()].join(':');
  const requestKey=`${theme}:${key}`;
  const cached=caches.get(theme),pending=requests.get(requestKey);
  if(feedError&&cached?.value.session.date===session.date)return {...cached.value,statisticsComplete:false,warnings:[...cached.value.warnings,'Feed updates are temporarily unavailable. Showing the previously loaded days.']};
  if(pending)return pending;
  const request=(async()=>{
    const warnings:string[]=[];
    let statisticsComplete=true;
    let filings:ReturnType<typeof projectSecIntelligence>=[],secAvailable=false,secFresh=false,truncated=false;
    const earliestDay=feed?.loadedFrom??session.date;
    const records=Object.values(feed?.days??{}).flat();
    if(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'){
      statisticsComplete=false;
      warnings.push('Local preview reads the published production graph. The SEC arrival feed is available only on the connected server.');
    }else try{
      if(feedError)throw feedError;
      const db=getAdminFirestore();
      const metadata=await changeCached(db,'sec-collector-freshness',['collector:sec-freshness'],()=>secCollectorFreshness(db).get());
      const lastRun=metadata.get('lastRunAt');
      secFresh=secCollectorIsFresh(lastRun,metadata.get('result'),now);
      if(!secFresh){
        warnings.push('SEC collector freshness is unverified. Filing records reflect stored discoveries, not guaranteed current coverage.');
      }
      const docs=records.filter(row=>row.collection==='sec_filings');
      filings=projectSecIntelligence(docs,graph,now).sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date));

      secAvailable=true;
    }catch(error){
      statisticsComplete=false;
      console.error('Intelligence SEC discovery feed unavailable',error);
      warnings.push('SEC discovery feed is temporarily unavailable. Stored research evidence remains available.');
    }
    let news:Awaited<ReturnType<typeof loadCollectedNews>>|undefined;
    let newsCoverage:IntelligenceSnapshot['newsCoverage'];
    if(process.env.INTELLIGENCE_NEWS_ENABLED==='1'&&!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'))try{
      if(feedError)throw feedError;
      news=await loadCollectedNews(getAdminFirestore(),graph,now,earliestDay,undefined,records.filter(row=>row.collection==='events').map(row=>row.data));
      const companyIds=graph.nodes.filter(node=>node.kind==='COMPANY'&&(theme!=='ai'||node.id.startsWith('US:'))).map(node=>node.id);
      const configured=new Set(news.configuredCompanyIds);
      const covered=companyIds.filter(id=>configured.has(id)).length;
      const configuredCompanyIds=companyIds.filter(id=>configured.has(id)),healthyCompanyIds=companyIds.filter(id=>news!.healthyCompanyIds.includes(id));
      newsCoverage={configured:covered,total:companyIds.length,healthy:healthyCompanyIds.length,companyIds,configuredCompanyIds,healthyCompanyIds};
      if(covered<companyIds.length)warnings.push(`Verified IR/news feeds cover ${covered} of ${companyIds.length} ${theme==='ai'?'US-listed ':''}${theme} Map companies. US-listed companies use SEC disclosures and Chinese issuers use exchange filings; other companies require supported official-news adapters.`);
      truncated=truncated||news.truncated;
      if(!news.fresh)warnings.push(`Company news collector freshness is unverified: ${news.unhealthy.join(', ')}.`);
    }catch(error){statisticsComplete=false;console.error('Intelligence company news unavailable',error);warnings.push('Company news arrivals are temporarily unavailable.');}
    const projected=projectResearchIntelligence(graph,theme==='ai'?curatedEvents:[],now);
    let disclosures:{events:ReturnType<typeof projectDisclosures>;truncated:boolean}|undefined;
    let calendarAvailable=true;
    if(!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'))try{
      if(feedError)throw feedError;
      disclosures={events:projectDisclosures(records.filter(row=>row.collection==='events').map(row=>row.data),graph,now),truncated:false};
      truncated=truncated||disclosures.truncated;
    }catch(error){statisticsComplete=false;console.error('Map disclosure feed unavailable',error);warnings.push('Company disclosure arrivals are temporarily unavailable.');}
    // A discovery and a research citation of the same filing are one document.
    let ordered=mergeIntelligenceEvents([...filings,...(news?.events??[]),...(disclosures?.events??[])],projected).filter(event=>event.publication_date>=earliestDay&&event.publication_date<=session.date);
    if(!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'))try{
      // Resolve every candidate's schedules before grouping or limiting the feed.
      ordered=await attachCalendarLinks(getAdminFirestore(),ordered);
    }catch(error){calendarAvailable=false;console.error('Intelligence calendar links unavailable',error);warnings.push('Calendar event links are temporarily unavailable.');}
    ordered=calendarAvailable?groupCompanyAnnouncements(ordered):[...groupCompanyAnnouncements(ordered.filter(event=>event.eventType==='insider_trade')),...ordered.filter(event=>event.eventType!=='insider_trade')];
    ordered.sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date)||a.id.localeCompare(b.id));
    const events=ordered;
    let priced={graph,eventReturns:{} as NonNullable<IntelligenceSnapshot['eventReturns']>};
    if(!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1')){
      priced=await attachPricePerformance(getAdminFirestore(),graph,events,now,priceView);
    }
    // Price changes must reach clients that retain the graph on unchanged polls.
    const graphVersion=createHash('sha256').update(JSON.stringify(priced.graph)).digest('hex');
    const evidenceChannels=new Set(graph.sources.map(source=>sourceChannel(source.url)));
    for(const event of ordered)for(const source of event.evidence)evidenceChannels.add(source.channel);
    const value:IntelligenceSnapshot={...(feed?{feedWindow:{loadedFrom:feed.loadedFrom,through:session.date,maxDays:7 as const,hasMore:feed.hasMore,version:feed.revision}}:{}),theme,graph:priced.graph,eventReturns:priced.eventReturns,graphVersion,events,sourceDocuments:sourceDocumentsForEvents(ordered),statisticsComplete,generatedAt:now.toISOString(),session,newsCoverage,coverage:INTELLIGENCE_SOURCES.map(channel=>({channel,status:(channel==='SEC'&&secAvailable&&secFresh)||(channel==='IR'&&news?.fresh)?'connected':evidenceChannels.has(channel)?'stored_evidence':'unavailable'})),warnings,truncated,limit:LIMIT};
    periods.set(value,ordered);
    // An older in-flight session must not overwrite a newer day's cache.
    const current=caches.get(theme);
    if(!current||Date.parse(current.value.generatedAt)<=now.getTime())caches.set(theme,{value,key});
    return value;
  })();
  requests.set(requestKey,request);
  try{return await request;}finally{if(requests.get(requestKey)===request)requests.delete(requestKey);}
}
