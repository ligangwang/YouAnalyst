import type { KnowledgeGraph } from '../knowledge-graph/model';
import { parseSecFilingDiscovered } from '../sec-filings/event';
import { easternDate, type IntelligenceEvent } from './model';

export type FilingDocument={id:string;data:Record<string,unknown>};
export function projectSecIntelligence(documents:FilingDocument[],graph:KnowledgeGraph,now=new Date()):IntelligenceEvent[] {
  const companies=new Set(graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id));
  const events:IntelligenceEvent[]=[];
  for(const document of documents){
    const discoveries=document.data.discoveryEvents;
    if(!discoveries||typeof discoveries!=='object')continue;
    const records=Object.entries(discoveries).flatMap(([key,value])=>{
      if(!value||typeof value!=='object'||!('state' in value)||!['pending','published'].includes(String(value.state))||!('event' in value))return [];
      try{
        const event=parseSecFilingDiscovered(value.event);
        return key===event.eventId&&event.accessionNumber===document.id&&Date.parse(event.discoveredAt)<=now.getTime()?[event]:[];
      }catch{return [];}
    }).sort((a,b)=>a.discoveredAt.localeCompare(b.discoveredAt));
    const companyIds=[...new Set(records.map(record=>`US:${record.companyId}`).filter(id=>companies.has(id)))];
    if(!companyIds.length||!records.length)continue;
    const first=records[0];
    const url=`https://www.sec.gov/Archives/edgar/data/${Number(first.cik)}/${first.accessionNumber.replaceAll('-','')}/${first.primaryDocument}`;
    events.push({id:`sec:${document.id}`,origin:companyIds[0],companyIds,edgeIds:[],category:'FILING',title:`${first.companyId} · ${first.form} filing`,summary:`SEC ${first.form} filed ${first.filingDate}. Recorded ${first.discoveredAt}. Filing discovery is not a claim about price impact or a completed graph extraction.`,observedAt:first.discoveredAt,observedDate:easternDate(new Date(first.discoveredAt)),eventDate:first.filingDate,evidence:[{id:url,url,title:`${first.companyId} ${first.form} · ${first.accessionNumber}`,sourceDate:first.filingDate,channel:'SEC'}],planned:false});
  }
  return events;
}
