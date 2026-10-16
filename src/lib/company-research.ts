import { companyName } from "./knowledge-graph/model";
import { companySector } from "./knowledge-graph/sectors";
import { INDUSTRY_SEGMENTS } from "./industry-graph/catalog";
import { normalizeCompanyProfile } from "./company-profile";
import { RELATIONSHIP_LABELS, type IndustryGraph } from "./industry-graph/model";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildCompanyResearch(ticker: string, listings: Record<string, unknown>[], graph: IndustryGraph | null) {
  const listing = listings.filter((item) => item.symbol === ticker && item.active === true && item.predictionSupported === true)
    .sort((a, b) => (Number(b.exchangePriority) || 0) - (Number(a.exchangePriority) || 0))[0];
  const node = graph?.nodes.find((item) => item.ticker === ticker && (!item.market || item.market === "US"));
  const nodes = new Map(graph?.nodes.map((item) => [item.id, item]) ?? []);
  const connections = node ? (graph?.edges ?? []).filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      const related = edge.source === node.id ? target : source;
      return { id: edge.id, label: `${source.name} ${RELATIONSHIP_LABELS[edge.type] ?? edge.type.toLowerCase().replaceAll("_", " ")} ${target.name}`, related, summary: edge.summary, commercialStatus: edge.commercialStatus, evidence: edge.evidence };
    }) : [];
  return {
    ticker,
    slug: text(listing?.slug),
    listingStatus: listing?.listingStatus,
    profile: normalizeCompanyProfile(listing?.profile),
    name: text(listing?.name) ?? text(node?.aliases?.[0]) ?? node?.name ?? ticker,
    names: {
      en: text((listing?.names as Record<string, unknown> | undefined)?.en) ?? node?.names?.en,
      "zh-CN": text((listing?.names as Record<string, unknown> | undefined)?.["zh-CN"]) ?? node?.names?.["zh-CN"],
    },
    known: Boolean(listing || node),
    exchange: text(listing?.exchange),
    currency: text(listing?.currency),
    country: text(listing?.country),
    securityType: text(listing?.type),
    listingUpdatedAt: text(listing?.lastSyncedAt),
    segment: INDUSTRY_SEGMENTS.find((item) => item.id === node?.segment)?.label ?? null,
    sector: node?.stageIds ? companySector(node) : null,
    inMap: Boolean(node),
    graphAvailable: graph !== null,
    connections,
  };
}

export type CompanyResearch = ReturnType<typeof buildCompanyResearch>;

// Searchers look for "<ticker> stock", so the headline leads with that and names
// only what the page actually shows: earnings and relationships exist for map companies.
export function companyPageHeadline(company: CompanyResearch, locale = "en") {
  const name = companyName({id: company.ticker, name: company.name, names: company.names}, locale);
  const zh = locale === "zh-CN";
  const topics = company.connections.length ? (zh ? "AI 产业链、财报与分析师观点" : "AI Supply Chain, Earnings & Analyst Views")
    : company.inMap ? (zh ? "财务、财报与分析师观点" : "Financials, Earnings & Analyst Views")
    : (zh ? "财务与分析师观点" : "Financials & Analyst Views");
  return zh ? `${name}（${company.ticker}）股票：${topics}` : `${name} (${company.ticker}) Stock: ${topics}`;
}

export function companyResearchDescription(company: CompanyResearch, locale = "en") {
  const name = companyName({id: company.ticker, name: company.name, names: company.names}, locale);
  const sector = company.sector && company.sector.id !== "other" ? company.sector : null;
  if (locale === "zh-CN") return `${name}（${company.ticker}）股票${company.exchange ? `，${company.exchange} 上市` : ""}${sector ? ` · ${sector.zh}` : ""}。研究其公司业务与财务${company.inMap ? "、最新财报" : ""}${company.connections.length ? "、有来源支持的产业链关系" : ""}，以及公开分析师观点。`;
  return `${name} (${company.ticker}) stock${company.exchange ? ` on ${company.exchange}` : ""}${sector ? ` · ${sector.en}` : ""}. Research its business and financials${company.inMap ? ", latest earnings" : ""}${company.connections.length ? ", sourced company relationships" : ""}, and public analyst views.`;
}
