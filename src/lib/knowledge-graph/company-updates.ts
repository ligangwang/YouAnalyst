import type { KnowledgeGraph } from "./model";
import type { PublicEvent } from "../events/model";
import { relationAnchor, researchCompanyUrl } from "./research-view";

export type CompanyUpdate = { id: string; kind: "RESEARCH" | "FILING"; companyIds: string[]; collectedAt: string; eventDate: string | null; sourceDate: string | null; sourceUrl: string; sourceTitle: string; description: string; href: string; edgeId?: string; factId?: string; state?: string };
const date = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
export function companyUpdates(graph: KnowledgeGraph, followedIds: string[], filings: PublicEvent[] = []): CompanyUpdate[] {
  const followed = new Set(followedIds), nodes = new Map(graph.nodes.filter(n => n.kind === "COMPANY").map(n => [n.id, n]));
  const items: CompanyUpdate[] = [];
  for (const edge of graph.relationships) {
    if (edge.type === "PARTICIPATES_IN" || (!followed.has(edge.source) && !followed.has(edge.target))) continue;
    const focal = nodes.get(followed.has(edge.source) ? edge.source : edge.target);
    if (!focal) continue;
    const facts = edge.facts?.length ? edge.facts : [{ scope: edge.summary, state: edge.commercialStatus, sourceIds: edge.sourceIds }];
    for (const [i, fact] of facts.entries()) {
      // A review timestamp describes collection/research activity, never the date of the business event.
      const collectedAt = date(fact.reviewedAt) ?? date(edge.researchReviewedAt) ?? date(edge.publishedAt);
      const source = graph.sources.filter(s => fact.sourceIds.includes(s.id) && s.url.startsWith("https://")).sort((a,b) => (b.sourceDate ?? "").localeCompare(a.sourceDate ?? ""))[0];
      if (!collectedAt || !source) continue;
      items.push({ id: `${edge.id}:${fact.id ?? i}`, kind: "RESEARCH", companyIds: [edge.source, edge.target], collectedAt, eventDate: date(fact.eventDate), sourceDate: date(source.sourceDate), sourceUrl: source.url, sourceTitle: source.title, description: fact.scope, href: `${researchCompanyUrl(focal)}#${relationAnchor(edge.id)}`, edgeId: edge.id, factId: fact.id, state: fact.state });
    }
  }
  for (const filing of filings) {
    const companyIds = filing.tickers.map(t => `US:${t}`).filter(id => followed.has(id) && nodes.has(id));
    if (!companyIds.length || !filing.sourceUrl.startsWith("https://www.sec.gov/Archives/")) continue;
    const focal = nodes.get(companyIds[0])!;
    items.push({ id: filing.id, kind: "FILING", companyIds, collectedAt: filing.publishedAt, eventDate: filing.occurredAt, sourceDate: filing.occurredAt, sourceUrl: filing.sourceUrl, sourceTitle: filing.title, description: filing.summary, href: `${researchCompanyUrl(focal)}#${filing.type === "SEC_FORM4" ? "insider-transactions" : "institutional-holdings"}` });
  }
  return [...new Map(items.map(i => [i.id,i])).values()].sort((a,b) => b.collectedAt.localeCompare(a.collectedAt) || a.id.localeCompare(b.id));
}
