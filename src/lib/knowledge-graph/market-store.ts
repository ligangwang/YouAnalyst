import { companyGeography } from "../market-companies/identity";
import type { GraphFact, GraphEdge, GraphNode, GraphSource, KnowledgeGraph } from "./model";
export const RELATIONSHIP_COLLECTION = "company_relationships";
export type AiMembership = { status: "PUBLISHED"; stageIds: string[]; stages: GraphNode[]; memberships: GraphEdge[]; sources: GraphSource[]; order: number; asOf: string };
export type MarketCompany = Record<string, unknown> & { id: string; aiGraph?: AiMembership };
export type MarketRelationship = Record<string, unknown> & { id: string; source: string; target: string; type: string; status: string; evidence?: (GraphSource & { summary?: string })[] };
export function relationshipId(source: string, target: string, type: string) {
  if (["PARTNER_OF", "COMPETES_WITH", "ECOSYSTEM_PARTNER_OF"].includes(type)) [source, target] = [source, target].sort();
  return `${source}__${type}__${target}`;
}
// The map projects the company master and published evidence; it is not a second store.
export function graphFromMarket(companies: MarketCompany[], records: MarketRelationship[]): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>(), sources = new Map<string, GraphSource>(), relationships = new Map<string, GraphEdge>();
  const publicCompanies = companies.filter(c => ["PUBLISHED", "DIRECTORY"].includes(String(c.status)) && c.name);
  const eligible = new Set(publicCompanies.filter(c => c.aiGraph?.status === "PUBLISHED").map(c => c.id));
  const related = records.filter(r => r.status === "PUBLISHED" && r.evidence?.length && r.source !== r.target && (eligible.has(r.source) || eligible.has(r.target)));
  const included = new Set([...eligible, ...related.flatMap(r => [r.source, r.target])]), dates: string[] = [];
  for (const c of publicCompanies.filter(c => included.has(c.id))) {
    const ai = c.aiGraph?.status === "PUBLISHED" ? c.aiGraph : undefined;
    const stageIds = ai?.stageIds.length ? ai.stageIds : ["related"];
    for (const s of ai?.stages ?? [{ id: "stage:related", kind: "STAGE" as const, order: 100, labels: { en: "Related companies", "zh-CN": "关联公司" } }]) {
      const old = nodes.get(s.id);
      nodes.set(s.id, { ...s, labels: { ...old?.labels, ...s.labels } });
    }
    for (const s of ai?.sources ?? []) sources.set(s.id, s);
    nodes.set(c.id, { id: c.id, kind: "COMPANY", name: String(c.name), names: Object.fromEntries(Object.entries((c.names && typeof c.names === "object" ? c.names : {}) as Record<string, unknown>).filter(([key,value]) => ["en", "zh-CN"].includes(key) && typeof value === "string" && value.trim())), aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === "string") : [], symbol: String(c.symbol ?? (c.id.startsWith("ORG:") ? "" : c.id.split(":")[1])), market: c.id.startsWith("US:") ? "US" : /^(XSHG|XSHE):/.test(c.id) ? "CN_A" : "GLOBAL", ...companyGeography(c), summary: String(c.description ?? ""), order: ai?.order ?? 1000, stageIds, sourceIds: ai?.sources.map(s => s.id) ?? [] });
    for (const e of ai?.memberships ?? []) relationships.set(e.id, e);
    if (ai?.asOf) dates.push(ai.asOf);
  }
  for (const r of related) {
    if (!nodes.has(r.source) || !nodes.has(r.target)) continue;
    const evidence = r.evidence!.filter(s => typeof s.url === "string" && s.url.startsWith("https://") && s.title);
    if (!evidence.length) continue;
    const sourceIds = evidence.map((s, i) => {
      const id = s.id || `${r.id}:source:${i}`;
      sources.set(id, { id, url: s.url, title: s.title, sourceDate: s.sourceDate ?? null });
      return id;
    });
    const facts: GraphFact[] = Array.isArray(r.facts) ? r.facts.flatMap((f: Record<string, unknown>) => {
      if (!f || typeof f.scope !== "string" || !["DOCUMENTED", "ANNOUNCED"].includes(String(f.state)) || !Array.isArray(f.sourceIds)) return [];
      const linked = f.sourceIds.filter((id): id is string => typeof id === "string" && sourceIds.includes(id));
      if (!linked.length) return [];
      return [{ state: String(f.state), scope: f.scope, sourceIds: linked,
        ...(typeof f.id === "string" ? { id: f.id } : {}),
        ...(typeof f.limitation === "string" ? { limitation: f.limitation } : {}),
        ...(typeof f.reviewedAt === "string" ? { reviewedAt: f.reviewedAt } : {}),
        ...(typeof f.eventDate === "string" ? { eventDate: f.eventDate } : {}) }];
    }) : [];
    const id = relationshipId(r.source, r.target, r.type), previous = relationships.get(id);
    relationships.set(id, { id, facts, ...(typeof r.researchReviewedAt === "string" ? { researchReviewedAt: r.researchReviewedAt } : {}), ...(typeof r.publishedAt === "string" ? { publishedAt: r.publishedAt } : {}), source: r.source, target: r.target, type: r.type, summary: String(r.summary ?? evidence[0].summary ?? ""), commercialStatus: String(r.commercialStatus ?? "DOCUMENTED"), sourceIds: [...new Set([...(previous?.sourceIds ?? []), ...sourceIds])] });
  }
  return { nodes: [...nodes.values()], relationships: [...relationships.values()], sources: [...sources.values()], asOf: dates.sort()[0] ?? "" };
}
