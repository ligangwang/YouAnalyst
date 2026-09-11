import type { ChinaCompany } from "../../src/lib/industry-research/china";
import { companySearchText, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

// The directory is a list view of the same published companies as the graph.
export function graphChinaCompanies(graph: KnowledgeGraph): ChinaCompany[] {
  const sources = new Map(graph.sources.map(s => [s.id, s]));
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  return graph.nodes.filter(n => n.kind === "COMPANY" && n.market === "CN_A").map(n => {
    const stage = nodes.get(`stage:${n.stageIds?.[0]}`);
    const source = n.sourceIds?.map(id => sources.get(id)).find(s => s && /^https:\/\//.test(s.url));
    if (!source) throw new Error("Published company is missing evidence");
    return { id: n.id, name: n.name ?? n.symbol ?? n.id, stage: stage?.labels?.["zh-CN"] ?? stage?.label ?? "", stageEn: stage?.labels?.en,
      description: n.summary ?? "", source: source.url, sourceLabel: source.title, searchText: companySearchText(graph, n) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

