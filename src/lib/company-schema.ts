import { companyName } from "./knowledge-graph/model";
import type { CompanyProfile } from "./company-profile";

export function companyOrganizationSchema(company: { id: string; name: string; names?: Partial<Record<"en" | "zh-CN", string>>; profile?: CompanyProfile | null }, locale: string, pageUrl: string, ticker?: string, exchange?: string | null) {
  return {
    "@type": ticker && exchange ? "Corporation" : "Organization",
    "@id": `${pageUrl}#company`,
    name: companyName(company, locale),
    alternateName: [...new Set(Object.values(company.names ?? {}).filter(Boolean))],
    url: company.profile?.website?.url ?? pageUrl,
    mainEntityOfPage: { "@id": pageUrl },
    ...(ticker && exchange ? { tickerSymbol: `${exchange}: ${ticker}` } : {}),
    ...(company.profile?.investorRelations ? { sameAs: [company.profile.investorRelations.url] } : {}),
  };
}
