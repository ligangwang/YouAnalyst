import type { CompanyListing } from "../market-companies/identity";
import type { PrivateValuation } from "../fundamentals/private-valuations";
import type { DailyPrice } from '../intelligence/price-performance';
export type GraphPrivateValuation = PrivateValuation & { verification: "source_checked" | "reviewed"; reviewPending: boolean };
export type Market = "US" | "CN_A" | "GLOBAL";
// `value` is always USD so map sizing is comparable across markets; A-shares also
// carry the CNY value and the FX rate date used for the conversion.
export type GraphMarketCap = { value: number; currency: "USD"; priceDate: string; local?: { value: number; currency: "CNY"; rateDate: string } };
export type GraphNode = { dailyPrice?: DailyPrice; editorialReviewedAt?: string; privateValuation?: GraphPrivateValuation; marketCap?: GraphMarketCap; id: string; kind: "STAGE" | "COMPANY"; label?: string; labels?: Record<string, string>; name?: string; names?: Partial<Record<"en" | "zh-CN", string>>; aliases?: string[]; symbol?: string; market?: Market; country?: string; listingStatus?: "PUBLIC" | "PRIVATE" | "UNKNOWN"; listings?: CompanyListing[]; order: number; stageIds?: string[]; summary?: string; summaryZh?: string; sourceIds?: string[] };
export type GraphFact = { editorialReviewedAt?: string; verificationStatus?: "CONFIRMED" | "PENDING" | "TERMINATED"; id?: string; state: string; scope: string; sourceIds: string[]; limitation?: string; reviewedAt?: string; eventDate?: string };
export type GraphEdge = { publishedAt?: string; researchReviewedAt?: string; facts?: GraphFact[]; id: string; source: string; target: string; type: string; summary: string; sourceIds: string[]; commercialStatus: string };
export type GraphSource = { id: string; title: string; url: string; sourceDate: string | null };
export type KnowledgeGraph = { nodes: GraphNode[]; relationships: GraphEdge[]; sources: GraphSource[]; asOf: string };

// Company IDs are global; source/relationship IDs are local to each snapshot.
export function combineGraphs(graphs: (KnowledgeGraph & { id: string; language: string })[]): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const relationships: GraphEdge[] = [], sources: GraphSource[] = [];
  for (const graph of graphs) {
    const prefix = (id: string) => `${graph.id}:${id}`;
    for (const n of graph.nodes) {
      if (n.kind === "STAGE") {
        const old = nodes.get(n.id);
        nodes.set(n.id, { ...n, labels: { ...old?.labels, [graph.language]: n.label ?? n.id } });
      } else nodes.set(n.id, { ...n, sourceIds: n.sourceIds?.map(prefix) });
    }
    sources.push(...graph.sources.map(s => ({ ...s, id: prefix(s.id) })));
    relationships.push(...graph.relationships.map(e => ({ ...e, id: prefix(e.id), sourceIds: e.sourceIds.map(prefix) })));
  }
  return { nodes: [...nodes.values()], relationships, sources, asOf: graphs.map(g => g.asOf).sort()[0] ?? "" };
}

export function companyName(company: Pick<GraphNode, "id" | "name" | "names">, locale: string): string {
  return company.names?.[locale === "zh-CN" ? "zh-CN" : "en"]?.trim() || company.name || company.id;
}

export function companySummary(company: Pick<GraphNode, "summary" | "summaryZh">, locale: string): string {
  return (locale === "zh-CN" ? company.summaryZh?.trim() : undefined) || company.summary || "";
}

export function companySearchText(graph: KnowledgeGraph, company: GraphNode): string {
  const stages = graph.nodes.filter(n => n.kind === "STAGE" && company.stageIds?.includes(n.id.slice(6)));
  return [company.id, company.name, ...Object.values(company.names ?? {}), ...(company.aliases ?? []), company.symbol, company.summary, company.summaryZh, ...stages.flatMap(n => [n.label, ...Object.values(n.labels ?? {})])].filter(Boolean).join(" ");
}

export function matchesCompanySearch(searchText: string, query: string): boolean {
  return searchText.normalize("NFKC").toLowerCase().includes(query.normalize("NFKC").trim().toLowerCase());
}

/** Exact identifiers precede name matches and broad business-description matches. */
export function companySearchRank(company: GraphNode, query: string): number {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const q = normalize(query).replace(/^\$/, "");
  if (!q) return 0;
  const identifiers = [company.symbol, company.id, company.id.split(":").pop()].filter((value): value is string => Boolean(value)).map(normalize);
  if (identifiers.includes(q)) return 0;
  if (identifiers.some(value => value.startsWith(q))) return 1;
  const names = [company.name, ...Object.values(company.names ?? {}), ...(company.aliases ?? [])].filter((value): value is string => Boolean(value)).map(normalize);
  if (names.includes(q)) return 2;
  if (names.some(value => value.startsWith(q))) return 3;
  return 4;
}

export function filterGraph(graph: KnowledgeGraph, markets: Market[], query = ""): KnowledgeGraph {
  const q = query.trim().toLowerCase();
  const companies = graph.nodes.filter(n => n.kind === "COMPANY" && n.market && markets.includes(n.market) && (!q || matchesCompanySearch(companySearchText(graph, n), query)));
  const stages = new Set(companies.flatMap(n => n.stageIds ?? []).map(id => `stage:${id}`));
  const nodes = [...graph.nodes.filter(n => n.kind === "STAGE" && stages.has(n.id)), ...companies];
  const ids = new Set(nodes.map(n => n.id));
  return { ...graph, nodes, relationships: graph.relationships.filter(e => ids.has(e.source) && ids.has(e.target)) };
}

export function layoutGraph(nodes: GraphNode[]) {
  const positions = new Map<string, { x: number; y: number }>();
  const stages = nodes.filter(n => n.kind === "STAGE").sort((a, b) => a.order - b.order);
  const groups: { node: GraphNode; x: number; y: number; height: number }[] = [];
  let y = 32;
  for (let row = 0; row < stages.length; row += 4) {
    const batch = stages.slice(row, row + 4).map(stage => ({ stage, companies: nodes.filter(n => n.kind === "COMPANY" && `stage:${n.stageIds?.[0]}` === stage.id).sort((a, b) => (a.market ?? "").localeCompare(b.market ?? "") || a.order - b.order) }));
    const height = Math.max(160, ...batch.map(b => 80 + Math.ceil(b.companies.length / 2) * 62));
    batch.forEach(({ stage, companies }, col) => {
      const x = 32 + col * 390;
      groups.push({ node: stage, x, y, height });
      positions.set(stage.id, { x: x + 178, y: y + 28 });
      companies.forEach((n, i) => positions.set(n.id, { x: x + 18 + i % 2 * 166, y: y + 60 + Math.floor(i / 2) * 62 }));
    });
    y += height + 36;
  }
  return { positions, groups, width: 1592, height: Math.max(320, y) };
}
