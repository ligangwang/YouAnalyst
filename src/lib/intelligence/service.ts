import {loadPriceCache} from './price-cache';
import {changeCached,withCacheReadScope} from '../change-cache';
import {loadCachedFeed} from './feed-cache-store';
import { createHash } from 'node:crypto';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import { loadThemeGraph,loadThemeGraphStructure } from '../company-themes/graph-service';
import { type CompanyThemeId } from '../company-themes/model';
import { curatedEvents } from '../knowledge-graph/curated-events';
import { secCollectorFreshness } from '../sec-filings/store';
import { INTELLIGENCE_SOURCES, sourceDocumentsForEvents, intelligenceSession, secCollectorIsFresh, sourceChannel, type IntelligenceSnapshot } from './model';
import { mergeIntelligenceEvents, projectResearchIntelligence } from './project';
import { projectSecIntelligence } from './sec-events';
import { loadCollectedNews } from './collectors/projection';
import {loadNewsSourceCompanies,graphNewsSources} from './collectors/source-service';
import {isCalendarCandidate} from '../calendar/candidates';
import {projectDisclosures} from '../events/disclosure-projection';
import {attachPricePerformance} from './price-performance-service';
import {attachCalendarLinks} from '../calendar/intelligence-links';
import {groupCompanyAnnouncements} from './announcement-grouping';
import {companySearchRank,companySearchText,matchesCompanySearch} from '../knowledge-graph/model';

const LIMIT=10;
type ScheduleRefresh=(refresh:()=>Promise<void>)=>void;
const caches=new Map<string,{value:IntelligenceSnapshot;key:string}>();
declare global {var __intelligenceCoreSnapshotsV1:WeakMap<object,Map<string,IntelligenceSnapshot>>|undefined;}
const coreSnapshots=globalThis.__intelligenceCoreSnapshotsV1??=new WeakMap<object,Map<string,IntelligenceSnapshot>>();
const requests=new Map<string,Promise<IntelligenceSnapshot>>();
// Retain the full period privately; company feeds reuse the same database read.
const periods=new WeakMap<IntelligenceSnapshot,IntelligenceSnapshot['events']>();
const companyRequests=new WeakMap<IntelligenceSnapshot,Map<string,Promise<IntelligenceSnapshot>>>();
// Bootstrap and the feed request arrive together. Share only active graph work;
// completed results must not hide live corrections on the next refresh.
type UniverseGraph=Awaited<ReturnType<typeof loadThemeGraph>>;
const universeRequests=new Map<CompanyThemeId,{structure:Promise<UniverseGraph>;complete:Promise<UniverseGraph>}>();

/** The directory can render without waiting for source reads or price enrichment. */
export async function loadIntelligenceUniverse(now=new Date(),theme:CompanyThemeId='ai'):Promise<IntelligenceSnapshot>{
  const graph=await loadUniverseGraph(theme);
  return {theme,graph,graphVersion:createHash('sha256').update(JSON.stringify(graph)).digest('hex'),events:[],sourceDocuments:[],eventsPending:true,statisticsComplete:false,generatedAt:now.toISOString(),session:intelligenceSession(now),coverage:[],warnings:[],truncated:false,limit:LIMIT};
}

function universeWork(theme:CompanyThemeId){
  const pending=universeRequests.get(theme);if(pending)return pending;
  const preview=process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1';
  const structure=preview
    ?fetch(`https://youanalyst.com/api/knowledge-graph?theme=${theme}`,{cache:'no-store',signal:AbortSignal.timeout(15_000)}).then(async response=>{if(!response.ok)throw new Error('Published graph unavailable');return await response.json() as Awaited<ReturnType<typeof loadKnowledgeGraph>>;})
    :loadThemeGraphStructure(theme);
  const complete=preview?structure:structure.then(graph=>loadThemeGraph(theme,graph));
  const request={structure,complete};
  universeRequests.set(theme,request);
  // Observe errors immediately, including when the feed has not reached pricing.
  void complete.finally(()=>{if(universeRequests.get(theme)===request)universeRequests.delete(theme);}).catch(()=>{});
  return request;
}
async function loadUniverseGraph(theme:CompanyThemeId){return universeWork(theme).complete;}

/** Only IDs present in the published snapshot can request enrichment. No client
 * supplied event dates, evidence or company records are trusted. */
export async function loadIntelligenceEnrichment(theme:CompanyThemeId,eventIds:string[],companyIds:string[],kind:'calendar'|'prices',snapshotAt:string,now=new Date()){
  const cached=coreSnapshots.get(getAdminFirestore())?.get(theme);
  const base=cached?.generatedAt===snapshotAt?cached:await loadIntelligenceSnapshot(now,theme,undefined,undefined,true);
  const selected=new Set(eventIds),companies=new Set(companyIds);
  const events=base.events.filter(event=>selected.has(event.id)||event.relatedEventIds?.some(id=>selected.has(id)));
  if(kind==='calendar'){
    const loaded=await attachCalendarLinks(getAdminFirestore(),events);
    return {calendar:Object.fromEntries(loaded.map(event=>[event.id,event.calendarEvents??[]]))};
  }
  for(const event of events)for(const id of event.companyIds)companies.add(id);
  const graph={...base.graph,nodes:base.graph.nodes.filter(node=>node.kind==='COMPANY'&&companies.has(node.id))};
  if(graph.nodes.length>200)throw Error('Price enrichment scope is too large');
  const priced=await attachPricePerformance(getAdminFirestore(),graph,events,now);
  return {eventReturns:priced.eventReturns,prices:Object.fromEntries(priced.graph.nodes.map(node=>[node.id,node.dailyPrice??null]))};
}

export async function loadCompanyIntelligenceSnapshot(now=new Date(),theme:CompanyThemeId='ai',company='',query='',region='',scheduleRefresh?:ScheduleRefresh,before?:string,core=false):Promise<IntelligenceSnapshot>{
  const base=await loadIntelligenceSnapshot(now,theme,scheduleRefresh,before,core);
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
    if(!core&&!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1')){
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
export async function loadIntelligenceSnapshot(now=new Date(),theme:CompanyThemeId='ai',_scheduleRefresh?:ScheduleRefresh,before?:string,core=false):Promise<IntelligenceSnapshot>{
  return withCacheReadScope(()=>buildIntelligenceSnapshot(now,theme,before,core));
}
async function buildIntelligenceSnapshot(now:Date,theme:CompanyThemeId,before?:string,core=false):Promise<IntelligenceSnapshot>{
  const started=performance.now();
  const timed=async<T>(stage:string,work:Promise<T>)=>{const start=performance.now();try{return await work;}finally{if(core)console.info(JSON.stringify({event:'intelligence_stage_duration',theme,stage,durationMs:Math.round(performance.now()-start)}));}};
  const settle=<T>(work:Promise<T>)=>work.then(value=>({value,error:undefined as unknown}),error=>({value:undefined,error}));
  const session=intelligenceSession(now);
  const preview=process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1';
  const universe=universeWork(theme);
  let feedError:unknown;
  const feedRead=preview?Promise.resolve(undefined):timed('feed',loadCachedFeed(getAdminFirestore(),now,before)).catch(error=>{feedError=error;return undefined;});
  // Configuration and freshness do not depend on graph valuations or feed data.
  const sourceRead=core&&!preview&&process.env.INTELLIGENCE_NEWS_ENABLED==='1'?settle(timed('news_sources',loadNewsSourceCompanies(getAdminFirestore(),theme))):undefined;
  const metadataRead=core&&!preview?settle(timed('collector_freshness',changeCached(getAdminFirestore(),'sec-collector-freshness',['collector:sec-freshness'],()=>secCollectorFreshness(getAdminFirestore()).get()))):undefined;
  const newsRead=sourceRead?settle(timed('news',Promise.all([feedRead,universe.structure,sourceRead]).then(async([feed,graph,sources])=>{
    if(feedError)throw feedError;if(sources.error)throw sources.error;
    const configured=await graphNewsSources(getAdminFirestore(),graph,sources.value??[]);
    return loadCollectedNews(getAdminFirestore(),graph,now,feed?.loadedFrom??session.date,undefined,Object.values(feed?.days??{}).flat().filter(row=>row.collection==='events').map(row=>row.data),configured);
  }))):undefined;
  const [feed,priceView,graph]=await Promise.all([
    feedRead,
    preview||core?undefined:loadPriceCache(getAdminFirestore()),
    timed('graph_structure',universe.structure),
  ]);
  // Re-evaluate clock-dependent coverage on reads; source data has no timer expiry.
  const key=[session.date,feed?.revision??'unavailable',priceView?.version??'',createHash('sha256').update(JSON.stringify(graph)).digest('hex'),now.getTime()].join(':');
  const cacheKey=`${theme}:${core?'core':'complete'}`,requestKey=`${cacheKey}:${key}`;
  const cached=caches.get(cacheKey),pending=requests.get(requestKey);
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
      const early=await metadataRead;if(early?.error)throw early.error;
      const metadata=early?.value??await changeCached(db,'sec-collector-freshness',['collector:sec-freshness'],()=>secCollectorFreshness(db).get());
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
      const early=await newsRead;if(early?.error)throw early.error;
      news=early?.value??await loadCollectedNews(getAdminFirestore(),graph,now,earliestDay,undefined,records.filter(row=>row.collection==='events').map(row=>row.data));
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
    if(!core&&!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'))try{
      // Resolve every candidate's schedules before grouping or limiting the feed.
      ordered=await attachCalendarLinks(getAdminFirestore(),ordered);
    }catch(error){calendarAvailable=false;console.error('Intelligence calendar links unavailable',error);warnings.push('Calendar event links are temporarily unavailable.');}
    if(core)ordered=ordered.map(event=>({...event,calendarPending:event.category==='BUSINESS'&&isCalendarCandidate(event.title,event.summary)}));
    ordered=calendarAvailable?groupCompanyAnnouncements(ordered):[...groupCompanyAnnouncements(ordered.filter(event=>event.eventType==='insider_trade')),...ordered.filter(event=>event.eventType!=='insider_trade')];
    ordered.sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date)||a.id.localeCompare(b.id));
    const events=ordered;
    let priced={graph:core?await universe.complete:graph,eventReturns:{} as NonNullable<IntelligenceSnapshot['eventReturns']>};
    if(!core&&!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1')){
      priced=await attachPricePerformance(getAdminFirestore(),await universe.complete,events,now,priceView);
    }
    // Price changes must reach clients that retain the graph on unchanged polls.
    const graphVersion=createHash('sha256').update(JSON.stringify(priced.graph)).digest('hex');
    const evidenceChannels=new Set(graph.sources.map(source=>sourceChannel(source.url)));
    for(const event of ordered)for(const source of event.evidence)evidenceChannels.add(source.channel);
    const value:IntelligenceSnapshot={...(feed?{feedWindow:{loadedFrom:feed.loadedFrom,through:session.date,maxDays:7 as const,hasMore:feed.hasMore,version:feed.revision}}:{}),theme,graph:priced.graph,eventReturns:priced.eventReturns,graphVersion,events,sourceDocuments:sourceDocumentsForEvents(ordered),statisticsComplete,generatedAt:now.toISOString(),session,newsCoverage,coverage:INTELLIGENCE_SOURCES.map(channel=>({channel,status:(channel==='SEC'&&secAvailable&&secFresh)||(channel==='IR'&&news?.fresh)?'connected':evidenceChannels.has(channel)?'stored_evidence':'unavailable'})),warnings,truncated,limit:LIMIT};
    periods.set(value,ordered);
    if(core)value.enrichmentDeferred=true;
    if(core){
      const db=getAdminFirestore();let shared=coreSnapshots.get(db);if(!shared){shared=new Map();coreSnapshots.set(db,shared);}
      const previous=shared.get(theme);if(!previous||Date.parse(previous.generatedAt)<=now.getTime())shared.set(theme,value);
    }
    // An older in-flight session must not overwrite a newer day's cache.
    const current=caches.get(cacheKey);
    if(!current||Date.parse(current.value.generatedAt)<=now.getTime())caches.set(cacheKey,{value,key});
    if(core)console.info(JSON.stringify({event:'intelligence_stage_duration',theme,stage:'core_total',durationMs:Math.round(performance.now()-started)}));
    return value;
  })();
  requests.set(requestKey,request);
  try{return await request;}finally{if(requests.get(requestKey)===request)requests.delete(requestKey);}
}
