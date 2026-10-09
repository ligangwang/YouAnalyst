import { companyName, type KnowledgeGraph } from "../knowledge-graph/model";
import { relationLabels } from "../knowledge-graph/relationship-labels";
import { deepDives } from "../research/deep-dives";
import { infrastructureTopics } from "../research/infrastructure-topics";

/** An analyst view cites YouAnalyst research: a documented relationship on the AI map or a research deep-dive. */
export type ViewEvidenceRef = { kind: "relationship" | "research"; id: string };
/** Labels and link are snapshotted when the view is published, so pages can show citations without loading the map. */
export type ViewEvidence = ViewEvidenceRef & { label: { en: string; "zh-CN": string }; href: string };

export const MAX_VIEW_EVIDENCE = 5;
const ID = /^[A-Za-z0-9:._/-]{1,200}$/;

/** Shape-only validation of submitted references; resolveViewEvidence checks them against the research. */
export function parseViewEvidence(raw: unknown): ViewEvidenceRef[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Invalid evidence");
  const refs = raw.map(item => {
    const value = item as Record<string, unknown> | null;
    if (!value || (value.kind !== "relationship" && value.kind !== "research") || typeof value.id !== "string" || !ID.test(value.id)) throw new Error("Invalid evidence");
    return { kind: value.kind, id: value.id } as ViewEvidenceRef;
  });
  const unique = [...new Map(refs.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()];
  if (unique.length > MAX_VIEW_EVIDENCE) throw new Error(`Cite up to ${MAX_VIEW_EVIDENCE} sources`);
  return unique;
}

export type ResearchCitation = { id: string; path: string; title: { en: string; zh: string } };
/** Research deep-dives and topics that cover a company. */
export function researchForCompany(companyId: string): ResearchCitation[] {
  return [
    ...deepDives.filter(d => d.companies.some(c => c.id === companyId)).map(d => ({ id: d.slug, path: d.path, title: d.title })),
    ...infrastructureTopics.filter(t => t.evidence.some(e => e.companyId === companyId)).map(t => ({ id: t.slug, path: `/research/${t.slug}`, title: t.title })),
  ];
}

/** Documented company relationships on the maps that involve the company (industry-role memberships excluded). */
export function relationshipsForCompany(graph: KnowledgeGraph, companyId: string) {
  return graph.relationships.filter(edge => edge.type !== "PARTICIPATES_IN" && (edge.source === companyId || edge.target === companyId));
}

export function relationshipLabel(graph: KnowledgeGraph, edgeId: string) {
  const edge = graph.relationships.find(item => item.id === edgeId);
  if (!edge) return null;
  const name = (id: string, locale: string) => { const node = graph.nodes.find(n => n.id === id); return node ? companyName(node, locale) : id; };
  const [en, zh] = relationLabels[edge.type] ?? [edge.type, edge.type];
  return { en: `${name(edge.source, "en")} → ${name(edge.target, "en")} · ${en}`, "zh-CN": `${name(edge.source, "zh-CN")} → ${name(edge.target, "zh-CN")} · ${zh}` };
}

/** Analyst views cover every company on the AI, Robotics and Space maps; merge their graphs into one. */
export function mergeCoverageGraphs(graphs: KnowledgeGraph[]): KnowledgeGraph {
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
  return {
    nodes: unique(graphs.flatMap(graph => graph.nodes)),
    relationships: unique(graphs.flatMap(graph => graph.relationships)),
    sources: unique(graphs.flatMap(graph => graph.sources)),
    asOf: graphs.map(graph => graph.asOf).sort().at(-1) ?? "",
  };
}

export function isCoveredCompany(graph: KnowledgeGraph, companyId: string) {
  return graph.nodes.some(node => node.kind === "COMPANY" && node.id === companyId);
}

/**
 * Checks references against the AI map and the research library, and snapshots their labels.
 * A directional (bullish or bearish) view must cite at least one.
 */
export function resolveViewEvidence(refs: ViewEvidenceRef[], companyId: string, graph: KnowledgeGraph, directional: boolean): ViewEvidence[] {
  if (!isCoveredCompany(graph, companyId)) throw new Error("Analyst views cover companies on the AI, Robotics and Space maps. Choose a company from a map.");
  if (directional && !refs.length) throw new Error("Cite at least one relationship or research report that supports this view.");
  const relationships = new Set(relationshipsForCompany(graph, companyId).map(edge => edge.id));
  const research = new Map(researchForCompany(companyId).map(item => [item.id, item]));
  return refs.map(ref => {
    if (ref.kind === "relationship") {
      if (!relationships.has(ref.id)) throw new Error("A cited relationship does not involve this company.");
      return { ...ref, label: relationshipLabel(graph, ref.id)!, href: `/?${new URLSearchParams({ company: companyId, relationship: ref.id })}` };
    }
    const item = research.get(ref.id);
    if (!item) throw new Error("A cited research report does not cover this company.");
    return { ...ref, label: { en: item.title.en, "zh-CN": item.title.zh }, href: item.path };
  });
}
