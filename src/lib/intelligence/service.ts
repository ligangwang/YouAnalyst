import {readPeriodDocuments} from './period-query';
import { createHash } from 'node:crypto';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import { curatedEvents } from '../knowledge-graph/curated-events';
import { SEC_FILINGS_COLLECTION, secCollectorMetadata } from '../sec-filings/store';
import { INTELLIGENCE_SOURCES, sourceDocumentsForEvents, intelligenceSession, secCollectorIsFresh, sourceChannel, type IntelligenceSnapshot } from './model';
import { mergeIntelligenceEvents, projectResearchIntelligence } from './project';
import { projectSecIntelligence } from './sec-events';
import { loadCollectedNews } from './collectors/projection';
import { NEWS_SOURCES } from './collectors/sources';
import {loadMapDisclosures} from '../events/disclosure-projection';

const LIMIT=200,CACHE_MS=60_000;
let cached:{value:IntelligenceSnapshot;expires:number}|undefined;
let pending:Promise<IntelligenceSnapshot>|undefined;

/** One cached, paginated period read shared by browsers; only the event list is capped. */
export async function loadIntelligenceSnapshot(now=new Date()):Promise<IntelligenceSnapshot>{
  const session=intelligenceSession(now);
  if(cached&&cached.expires>now.getTime()&&cached.value.session.date===session.date)return cached.value;
  if(pending)return pending;
  pending=(async()=>{
    const graph=process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'
      ?await fetch('https://youanalyst.com/api/knowledge-graph',{cache:'no-store',signal:AbortSignal.timeout(15_000)}).then(async response=>{if(!response.ok)throw new Error('Published graph unavailable');return await response.json() as Awaited<ReturnType<typeof loadKnowledgeGraph>>;})
      :await loadKnowledgeGraph();
    const warnings:string[]=[];
    let statisticsComplete=true;
    let filings:ReturnType<typeof projectSecIntelligence>=[],secAvailable=false,secFresh=false,truncated=false;
    const earliestDay=new Date(Date.parse(`${session.date}T12:00:00Z`)-29*86_400_000).toISOString().slice(0,10);
    if(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'){
      statisticsComplete=false;
      warnings.push('Local preview reads the published production graph. The SEC arrival feed is available only on the connected server.');
    }else try{
      const db=getAdminFirestore();
      const metadata=await secCollectorMetadata(db).get();
      const lastRun=metadata.get('lastRunAt');
      secFresh=secCollectorIsFresh(lastRun,metadata.get('result'),now);
      if(!secFresh){
        warnings.push('SEC collector freshness is unverified. Filing records reflect stored discoveries, not guaranteed current coverage.');
      }
      const page=await readPeriodDocuments(db.collection(SEC_FILINGS_COLLECTION).where('filingDate','>=',earliestDay).orderBy('filingDate','desc'));
      const docs=page.map(doc=>({id:doc.id,data:doc.data()}));
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
      news=await loadCollectedNews(getAdminFirestore(),graph,now,earliestDay);
      const companyIds=graph.nodes.filter(node=>node.kind==='COMPANY'&&node.id.startsWith('US:')).map(node=>node.id);
      const configured=new Set(NEWS_SOURCES.map(source=>source.companyId));
      const covered=companyIds.filter(id=>configured.has(id)).length;
      newsCoverage={configured:covered,total:companyIds.length,healthy:companyIds.filter(id=>news!.healthyCompanyIds.includes(id)).length};
      if(covered<companyIds.length)warnings.push(`Verified IR/news feeds cover ${covered} of ${companyIds.length} US-listed AI Map companies. SEC disclosures cover companies awaiting an IR adapter.`);
      truncated=truncated||news.truncated;
      if(!news.fresh)warnings.push(`Company news collector freshness is unverified: ${news.unhealthy.join(', ')}.`);
    }catch(error){statisticsComplete=false;console.error('Intelligence company news unavailable',error);warnings.push('Company news arrivals are temporarily unavailable.');}
    const projected=projectResearchIntelligence(graph,curatedEvents,now);
    let disclosures:Awaited<ReturnType<typeof loadMapDisclosures>>|undefined;
    if(!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'))try{
      disclosures=await loadMapDisclosures(getAdminFirestore(),graph,now,earliestDay);
      truncated=truncated||disclosures.truncated;
    }catch(error){statisticsComplete=false;console.error('Map disclosure feed unavailable',error);warnings.push('Company disclosure arrivals are temporarily unavailable.');}
    // A discovery and a research citation of the same filing are one document.
    const ordered=mergeIntelligenceEvents([...filings,...(news?.events??[]),...(disclosures?.events??[])],projected).filter(event=>event.publication_date>=earliestDay&&event.publication_date<=session.date).sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date)||a.id.localeCompare(b.id));
    const events=ordered.slice(0,LIMIT);truncated=truncated||ordered.length>LIMIT;
    const graphVersion=createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    const evidenceChannels=new Set(graph.sources.map(source=>sourceChannel(source.url)));
    for(const event of ordered)for(const source of event.evidence)evidenceChannels.add(source.channel);
    const value:IntelligenceSnapshot={graph,graphVersion,events,sourceDocuments:sourceDocumentsForEvents(ordered),statisticsComplete,generatedAt:now.toISOString(),session,newsCoverage,coverage:INTELLIGENCE_SOURCES.map(channel=>({channel,status:(channel==='SEC'&&secAvailable&&secFresh)||(channel==='IR'&&news?.fresh)?'connected':evidenceChannels.has(channel)?'stored_evidence':'unavailable'})),warnings,truncated,limit:LIMIT};
    cached={value,expires:now.getTime()+CACHE_MS};
    return value;
  })();
  try{return await pending;}finally{pending=undefined;}
}
