import { companyName, type KnowledgeGraph } from "./model";
import { companySector } from "./sectors";
import { companyPageUrl } from "../market-companies/routes";
import type { IndustryGraph } from "../industry-graph/model";
import type { IndustrySegment } from "../industry-graph/catalog";

const segments: Record<string, IndustrySegment> = { semiconductors:"manufacturing", compute:"compute", memory:"memory", connectivity:"networking", systems:"devices", infrastructure:"infrastructure", platforms:"cloud", applications:"applications", other:"other" };
// Display-only projection: IDs, relationship types, direction and source URLs stay canonical.
export function companyResearchGraph(graph: KnowledgeGraph, locale="en"): IndustryGraph {
  const companies=graph.nodes.filter(n=>n.kind==="COMPANY");
  const ids=new Set(companies.map(n=>n.id));
  const byId=new Map(companies.map(n=>[n.id,n]));
  const sources=new Map(graph.sources.map(s=>[s.id,s]));
  return {
    nodes:companies.map(n=>({id:n.id,name:companyName(n,locale),names:n.names,ticker:n.symbol||null,
      segment:segments[companySector(n).id]??"other",kind:"published",market:n.market,
      profileUrl:companyPageUrl(n.market==="GLOBAL"?n.id:n.symbol||n.id,n.market),
      aliases:[n.name??"",...Object.values(n.names??{}),...(n.aliases??[])]})),
    edges:graph.relationships.filter(e=>e.type!=="PARTICIPATES_IN"&&ids.has(e.source)&&ids.has(e.target)).map(e=>({
      id:e.id,source:e.source,target:e.target,type:e.type,summary:e.summary,commercialStatus:e.commercialStatus,
      bidirectional:["COMPETES_WITH","PARTNER_OF","ECOSYSTEM_PARTNER_OF","ENERGY_AGREEMENT_WITH"].includes(e.type),
      evidence:e.sourceIds.flatMap(id=>{const s=sources.get(id);return s?[{id:s.id,quote:e.summary,filingDate:s.sourceDate??"",filingUrl:s.url,issuerTicker:byId.get(e.source)?.symbol||e.source,nameMatched:false,sourceKind:"web" as const,sourceTitle:s.title}]:[];})
    })),
    coveredTickers:companies.flatMap(n=>n.symbol?[n.symbol]:[]),updatedAt:graph.asOf||null,omittedEdges:0
  };
}
