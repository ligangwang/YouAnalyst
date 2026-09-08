import { INDUSTRY_SEGMENTS, INDUSTRY_STARTERS } from "./industry-graph/catalog";
import { RELATIONSHIP_LABELS, type IndustryGraph } from "./industry-graph/model";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildCompanyResearch(ticker: string, listings: Record<string, unknown>[], graph: IndustryGraph | null) {
  const starter = INDUSTRY_STARTERS.find((item) => item.ticker === ticker);
  const listing = listings.filter((item) => item.symbol === ticker && item.active === true && item.predictionSupported === true)
    .sort((a, b) => (Number(b.exchangePriority) || 0) - (Number(a.exchangePriority) || 0))[0];
  const node = graph?.nodes.find((item) => item.ticker === ticker);
  const nodes = new Map(graph?.nodes.map((item) => [item.id, item]) ?? []);
  const connections = node ? (graph?.edges ?? []).filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      const related = edge.source === node.id ? target : source;
      return { id: edge.id, label: `${source.name} ${RELATIONSHIP_LABELS[edge.type]} ${target.name}`, related, evidence: edge.evidence };
    }) : [];
  return {
    ticker,
    name: text(listing?.name) ?? starter?.aliases?.[0] ?? starter?.name ?? ticker,
    known: Boolean(listing || starter),
    exchange: text(listing?.exchange),
    currency: text(listing?.currency),
    country: text(listing?.country),
    securityType: text(listing?.type),
    listingUpdatedAt: text(listing?.lastSyncedAt),
    segment: INDUSTRY_SEGMENTS.find((item) => item.id === starter?.segment)?.label ?? null,
    inMap: Boolean(starter),
    graphAvailable: graph !== null,
    connections,
  };
}

export type CompanyResearch = ReturnType<typeof buildCompanyResearch>;

export function companyResearchDescription(company: CompanyResearch) {
  return `Research ${company.name} (${company.ticker}): institutional 13F holdings, insider transactions${company.inMap ? ", filing-backed company relationships" : ""}, and public investment views.`;
}
