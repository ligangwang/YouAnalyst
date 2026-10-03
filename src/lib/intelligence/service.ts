import { createHash } from 'node:crypto';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import { curatedEvents } from '../knowledge-graph/curated-events';
import { SEC_FILINGS_COLLECTION, secCollectorMetadata } from '../sec-filings/store';
import { INTELLIGENCE_SOURCES, intelligenceSession, secCollectorIsFresh, sourceChannel, type IntelligenceSnapshot } from './model';
import { mergeIntelligenceEvents, projectResearchIntelligence } from './project';
import { projectSecIntelligence } from './sec-events';
import { loadCollectedNews } from './collectors/projection';
import { NEWS_SOURCES } from './collectors/sources';

const LIMIT=200,CACHE_MS=60_000;
let cached:{value:IntelligenceSnapshot;expires:number}|undefined;
let pending:Promise<IntelligenceSnapshot>|undefined;

/** One bounded shared read, not one query or listener per company/browser. */
export async function loadIntelligenceSnapshot(now=new Date()):Promise<IntelligenceSnapshot>{
  const session=intelligenceSession(now);
  if(cached&&cached.expires>now.getTime()&&cached.value.session.date===session.date)return cached.value;
  if(pending)return pending;
  pending=(async()=>{
    const graph=process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'
      ?await fetch('https://youanalyst.com/api/knowledge-graph',{cache:'no-store',signal:AbortSignal.timeout(15_000)}).then(async response=>{if(!response.ok)throw new Error('Published graph unavailable');return await response.json() as Awaited<ReturnType<typeof loadKnowledgeGraph>>;})
      :await loadKnowledgeGraph();
    const warnings:string[]=[];
    let filings:ReturnType<typeof projectSecIntelligence>=[],secAvailable=false,secFresh=false,truncated=false;
    const earliestDay=new Date(Date.parse(`${session.date}T12:00:00Z`)-30*86_400_000).toISOString().slice(0,10);
    if(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'){
      warnings.push('Local preview reads the published production graph. The SEC arrival feed is available only on the connected server.');
    }else try{
      const db=getAdminFirestore();
      const metadata=await secCollectorMetadata(db).get();
      const lastRun=metadata.get('lastRunAt');
      secFresh=secCollectorIsFresh(lastRun,metadata.get('result'),now);
      if(!secFresh){
        warnings.push('SEC collector freshness is unverified. Filing records reflect stored discoveries, not guaranteed current coverage.');
      }
      const page=await db.collection(SEC_FILINGS_COLLECTION).where('intelligenceObservedAt','>=',`${earliestDay}T00:00:00.000Z`).orderBy('intelligenceObservedAt','desc').limit(LIMIT+1).get();
      truncated=page.size>LIMIT;
      let docs=page.docs.slice(0,LIMIT).map(doc=>({id:doc.id,data:doc.data()}));
      // Bridge pre-release discovery records while the collector writes the index.
      if(!metadata.get('intelligenceIndexReadyAt')){
        const legacy=await db.collection(SEC_FILINGS_COLLECTION).where('filingDate','>=',earliestDay).orderBy('filingDate','desc').limit(LIMIT+1).get();
        docs=[...new Map([...docs,...legacy.docs.slice(0,LIMIT).map(doc=>({id:doc.id,data:doc.data()}))].map(doc=>[doc.id,doc])).values()];
        truncated=truncated||legacy.size>LIMIT;
        if(legacy.size)warnings.push('SEC coverage uses a bounded legacy filing window until the discovery index is backfilled.');
      }
      filings=projectSecIntelligence(docs,graph,now).sort((a,b)=>b.observedAt!.localeCompare(a.observedAt!));
      if(filings.length>LIMIT){filings=filings.slice(0,LIMIT);truncated=true;}
      secAvailable=true;
    }catch(error){
      console.error('Intelligence SEC discovery feed unavailable',error);
      warnings.push('SEC discovery feed is temporarily unavailable. Stored research evidence remains available.');
    }
    let news:Awaited<ReturnType<typeof loadCollectedNews>>|undefined;
    if(process.env.INTELLIGENCE_NEWS_ENABLED==='1'&&!(process.env.NODE_ENV==='development'&&process.env.INTELLIGENCE_DEV_PUBLIC_GRAPH==='1'))try{
      news=await loadCollectedNews(getAdminFirestore(),graph,now,earliestDay,LIMIT);
      const companyIds=graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id);
      const configured=new Set(NEWS_SOURCES.map(source=>source.companyId));
      const covered=companyIds.filter(id=>configured.has(id)).length;
      if(covered<companyIds.length)warnings.push(`Company IR/news feeds cover ${covered} of ${companyIds.length} AI Map companies. Other companies do not yet have verified news collectors.`);
      truncated=truncated||news.truncated;
      if(!news.fresh)warnings.push(`Company news collector freshness is unverified: ${news.unhealthy.join(', ')}.`);
    }catch(error){console.error('Intelligence company news unavailable',error);warnings.push('Company news arrivals are temporarily unavailable.');}
    const projected=projectResearchIntelligence(graph,curatedEvents,now);
    // A discovery and a research citation of the same filing are one document.
    const events=mergeIntelligenceEvents([...filings,...(news?.events??[])],projected).filter(event=>event.observedDate>=earliestDay&&event.observedDate<=session.date).sort((a,b)=>(b.observedAt??b.observedDate).localeCompare(a.observedAt??a.observedDate)||a.id.localeCompare(b.id));
    const graphVersion=createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    const evidenceChannels=new Set(graph.sources.map(source=>sourceChannel(source.url)));
    for(const event of events)for(const source of event.evidence)evidenceChannels.add(source.channel);
    const value:IntelligenceSnapshot={graph,graphVersion,events,generatedAt:now.toISOString(),session,coverage:INTELLIGENCE_SOURCES.map(channel=>({channel,status:(channel==='SEC'&&secAvailable&&secFresh)||(channel==='IR'&&news?.fresh)?'connected':evidenceChannels.has(channel)?'stored_evidence':'unavailable'})),warnings,truncated,limit:LIMIT};
    cached={value,expires:now.getTime()+CACHE_MS};
    return value;
  })();
  try{return await pending;}finally{pending=undefined;}
}
