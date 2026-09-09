import { INDUSTRY_SEGMENTS, type IndustryCompany } from "../industry-graph/catalog";
import type { IndustryGraph, IndustryEdge } from "../industry-graph/model";

export const RESEARCH_VERSION = 1;
export const MAX_COMPANIES = 40;
export const MAX_RELATIONSHIPS = 80;
export type ResearchEvidence = { url: string; title: string; summary: string; sourceDate: string | null };
export type ResearchRelationship = {
  id: string; source: string; target: string; type: "SUPPLIER_OF" | "PARTNER_OF" | "COMPETES_WITH";
  evidence: ResearchEvidence[];
};
export type ResearchResult = { companies: IndustryCompany[]; relationships: ResearchRelationship[]; withheld: number };
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
export function normalizeSymbol(value: unknown): string {
  const symbol = text(value).replace(/^\$/, "").toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : "";
}
export function sourceUrl(value: unknown): string {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /\.(local|internal)$/i.test(url.hostname)) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}
export function canonicalRelationship(source: string, target: string, type: string) {
  if (type === "CUSTOMER_OF") { [source, target] = [target, source]; type = "SUPPLIER_OF"; }
  if (!["SUPPLIER_OF", "PARTNER_OF", "COMPETES_WITH"].includes(type) || source === target) return null;
  if (type !== "SUPPLIER_OF") [source, target] = [source, target].sort();
  return { id: `${source}__${type}__${target}`, source, target, type: type as ResearchRelationship["type"] };
}

// Search provenance is required, but is not a claim that the source verifies the model's summary.
export function normalizeResearch(value: unknown, searchedUrls: string[]): ResearchResult {
  const raw = record(value);
  const companies = new Map<string, IndustryCompany>();
  for (const item of (Array.isArray(raw.companies) ? raw.companies : []).slice(0, MAX_COMPANIES)) {
    const c = record(item), ticker = normalizeSymbol(c.ticker), name = text(c.name).slice(0, 160);
    const segment = INDUSTRY_SEGMENTS.find(s => s.id === c.segment)?.id ?? "other";
    if (ticker && name && !companies.has(ticker)) companies.set(ticker, { ticker, name, segment });
  }
  const allowed = new Set(searchedUrls.map(sourceUrl).filter(Boolean));
  const relationships = new Map<string, ResearchRelationship>();
  let withheld = 0;
  const items = Array.isArray(raw.relationships) ? raw.relationships : [];
  withheld += Math.max(0, items.length - MAX_RELATIONSHIPS);
  for (const item of items.slice(0, MAX_RELATIONSHIPS)) {
    const r = record(item), source = normalizeSymbol(r.source), target = normalizeSymbol(r.target);
    const key = canonicalRelationship(source, target, text(r.type));
    const url = sourceUrl(r.url), summary = text(r.summary).slice(0, 1200), title = text(r.title).slice(0, 200);
    const date = text(r.sourceDate);
    if (!key || !companies.has(source) || !companies.has(target) || !url || !allowed.has(url) || !summary || !title) { withheld++; continue; }
    const evidence: ResearchEvidence = { url, summary, title, sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? date : null };
    const existing = relationships.get(key.id) ?? { ...key, evidence: [] };
    if (!existing.evidence.some(e => e.url === url) && existing.evidence.length < 5) existing.evidence.push(evidence);
    relationships.set(key.id, existing);
  }
  return { companies: [...companies.values()], relationships: [...relationships.values()], withheld };
}

export function mergeResearchGraph(graph: IndustryGraph, companies: IndustryCompany[], relationships: ResearchRelationship[]): IndustryGraph {
  const nodes = new Map(graph.nodes.map(n => [n.id, { ...n }]));
  const byTicker = new Map(graph.nodes.filter(n => n.ticker).map(n => [n.ticker!, n.id]));
  const directory = new Map(companies.map(c => [c.ticker, c]));
  const edges = new Map<string, IndustryEdge>();
  function add(edge: IndustryEdge) {
    let { source, target, type } = edge;
    if (type === "CUSTOMER_OF") { [source, target] = [target, source]; type = "SUPPLIER_OF"; }
    if (edge.bidirectional) [source, target] = [source, target].sort();
    const id = JSON.stringify([source, target, type, edge.bidirectional]);
    const prior = edges.get(id);
    edges.set(id, { ...edge, id, source, target, type, evidence: [...(prior?.evidence ?? []), ...edge.evidence].filter((e, i, all) => all.findIndex(x => x.id === e.id) === i) });
  }
  graph.edges.forEach(add);
  let omitted = graph.omittedEdges;
  for (const relation of relationships) {
    if (!directory.has(relation.source) || !directory.has(relation.target) || !relation.evidence.length) continue;
    if (edges.size >= 240) { omitted++; continue; }
    for (const ticker of [relation.source, relation.target]) {
      const company = directory.get(ticker)!;
      const id = byTicker.get(ticker) ?? `research:${ticker}`;
      const existing = nodes.get(id);
      nodes.set(id, existing ? { ...existing, kind: existing.kind === "coverage" ? "research" : existing.kind } : { id, ...company, kind: "research" });
      byTicker.set(ticker, id);
    }
    add({ id: relation.id, source: byTicker.get(relation.source)!, target: byTicker.get(relation.target)!, type: relation.type,
      bidirectional: relation.type !== "SUPPLIER_OF", evidence: relation.evidence.map((e, i) => ({
        id: `research:${relation.id}:${i}:${e.url}`, quote: e.summary, filingDate: e.sourceDate ?? "Date not supplied",
        filingUrl: e.url, issuerTicker: relation.source, nameMatched: false, sourceKind: "web", sourceTitle: e.title,
      })) });
  }
  return { ...graph, nodes: [...nodes.values()], edges: [...edges.values()], omittedEdges: omitted };
}
