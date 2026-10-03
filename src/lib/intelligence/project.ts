import type { KnowledgeGraph } from '../knowledge-graph/model';
import type { BusinessEvent } from '../knowledge-graph/business-events';
import { canonicalEvidenceUrl, easternDate, observation, sourceChannel, type IntelligenceEvent, type IntelligenceEvidence } from './model';

/** Clusters share an actual source URL. Co-mentions never create business edges. */
export function projectResearchIntelligence(graph:KnowledgeGraph,business:BusinessEvent[]=[],now=new Date()):IntelligenceEvent[] {
  const nodes=new Set(graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id));
  const sources=new Map(graph.sources.map(source=>[source.id,source]));
  const clusters=new Map<string,IntelligenceEvent>();
  const add=(input:{url:string;title:string;sourceDate:string|null;companyIds:string[];edgeIds:string[];summary:string;category:'RESEARCH'|'BUSINESS';eventDate?:string|null;planned?:boolean})=>{
    const url=canonicalEvidenceUrl(input.url),seen=observation(input.sourceDate);
    if(!url||!seen||seen.day>easternDate(now)||(seen.at&&Date.parse(seen.at)>now.getTime()))return;
    const companyIds=input.companyIds.filter(id=>nodes.has(id));
    if(!companyIds.length)return;
    const evidence:IntelligenceEvidence={id:url,url,title:input.title,sourceDate:input.sourceDate,channel:sourceChannel(url)};
    const existing=clusters.get(url);
    if(existing){
      existing.planned=existing.planned||Boolean(input.planned);
      existing.companyIds=[...new Set([...existing.companyIds,...companyIds])];
      existing.edgeIds=[...new Set([...existing.edgeIds,...input.edgeIds])];
      if(seen.day>existing.publication_date||(seen.day===existing.publication_date&&seen.at&&(existing.published_at===null||seen.at>existing.published_at))){existing.publication_date=seen.day;existing.published_at=seen.at;}
      if(input.category==='BUSINESS'){existing.category='BUSINESS';existing.title=input.title;existing.summary=input.summary;existing.eventDate=input.eventDate??null;existing.planned=Boolean(input.planned);}
    }else clusters.set(url,{id:`evidence:${url}`,origin:companyIds[0],companyIds,edgeIds:input.edgeIds,category:input.category,title:input.title,summary:input.summary,published_at:seen.at,publication_date:seen.day,eventDate:input.eventDate??null,evidence:[evidence],planned:Boolean(input.planned)});
  };
  for(const edge of graph.relationships){
    if(edge.type==='PARTICIPATES_IN')continue;
    const facts=edge.facts?.length?edge.facts:[{scope:edge.summary,state:edge.commercialStatus,sourceIds:edge.sourceIds,reviewedAt:undefined,eventDate:undefined}];
    for(const fact of facts)for(const id of fact.sourceIds){
      const source=sources.get(id);if(!source)continue;
      add({url:source.url,title:source.title,sourceDate:source.sourceDate,companyIds:[edge.source,edge.target],edgeIds:[edge.id],summary:fact.scope,category:'RESEARCH',eventDate:fact.eventDate,planned:fact.state==='ANNOUNCED'});
    }
  }
  for(const event of business){
    const edge=graph.relationships.find(candidate=>candidate.id===event.relationshipId);
    add({url:event.sourceUrl,title:event.sourceTitle,sourceDate:event.sourceDate,companyIds:event.companyIds,edgeIds:edge?[edge.id]:[],summary:event.summary,category:'BUSINESS',eventDate:event.eventDate,planned:event.planned});
    const cluster=clusters.get(canonicalEvidenceUrl(event.sourceUrl)??'');if(cluster)cluster.title=event.title;
  }
  return [...clusters.values()].sort((a,b)=>(b.published_at??b.publication_date).localeCompare(a.published_at??a.publication_date)||a.id.localeCompare(b.id));
}

/** Source publication owns the timestamp; its existing research paths remain visible. */
export function mergeIntelligenceEvents(filings:IntelligenceEvent[],research:IntelligenceEvent[]):IntelligenceEvent[]{
  const byUrl=new Map(research.flatMap(event=>event.evidence.map(source=>[source.url,event] as const)));
  const filingUrls=new Set(filings.flatMap(event=>event.evidence.map(source=>source.url)));
  return [...filings.map(filing=>{
    const related=filing.evidence.flatMap(source=>byUrl.has(source.url)?[byUrl.get(source.url)!]:[]);
    return {...filing,companyIds:[...new Set([...filing.companyIds,...related.flatMap(event=>event.companyIds)])],edgeIds:[...new Set([...filing.edgeIds,...related.flatMap(event=>event.edgeIds)])]};
  }),...research.filter(event=>!event.evidence.some(source=>filingUrls.has(source.url)))];
}
