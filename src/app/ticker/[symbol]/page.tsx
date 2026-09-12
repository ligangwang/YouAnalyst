import { localizedMetadata } from "@/lib/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CompanyFundamentalsLoader } from "@/components/company-fundamentals-loader";
import { TickerPage } from "@/components/ticker-page";
import { normalizeTicker } from "@/lib/predictions/types";
import { notFound, permanentRedirect } from "next/navigation";
import { loadCompanyResearch } from "@/lib/company-research-service";
import { companyResearchDescription } from "@/lib/company-research";
import { CompanyResearchOverview } from "@/components/company-research-overview";
import { absoluteUrl } from "@/lib/seo";
import { cache } from "react";
import { chinaCompanyId, companyPageUrl } from "@/lib/market-companies/routes";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { COMPANY_COLLECTION } from "@/lib/market-companies/model";
import { publicChinaCompany } from "@/lib/industry-research/china-directory";
import { ChinaCompanyPage } from "@/components/china-company-page";

const loadChinaCompany = cache(async (id: string) => {
  const doc = await getAdminFirestore().collection(COMPANY_COLLECTION).doc(id).get();
  const company = doc.exists ? publicChinaCompany(doc.id, doc.data()!) : null;
  if (!company) notFound();
  return company;
});

export const dynamic = "force-dynamic";

// Page and metadata parameters can differ in URL encoding.
function decodeRouteSymbol(symbol: string) {
  try { return decodeURIComponent(symbol); } catch { notFound(); }
}

function resolveTicker(symbol: string) {
  const ticker = normalizeTicker(symbol.replace(/^\$/, ""));
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) notFound();
  return ticker;
}

async function buildPageMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeRouteSymbol(rawSymbol);
  const chinaId = chinaCompanyId(symbol);
  if (chinaId) {
    const company = await loadChinaCompany(chinaId);
    return { title: `${company.name} (${chinaId.split(":")[1]}) | YouAnalyst`, description: company.description,
      alternates: { canonical: companyPageUrl(chinaId, "CN_A") } };
  }
  const ticker = resolveTicker(symbol);
  const company = await loadCompanyResearch(ticker);
  const title = `${company.name} (${ticker}) holdings & company research | YouAnalyst`;
  const description = companyResearchDescription(company);

  return {
    title,
    description,
    alternates: {
      canonical: `/ticker/${ticker}`,
    },
    openGraph: {
      title,
      description,
      url: `/ticker/${ticker}`,
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function TickerRoutePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeRouteSymbol(rawSymbol);
  const chinaId = chinaCompanyId(symbol);
  if (chinaId) {
    if (symbol !== chinaId) permanentRedirect(companyPageUrl(chinaId, "CN_A"));
    return <ChinaCompanyPage company={await loadChinaCompany(chinaId)} />;
  }
  const ticker = resolveTicker(symbol);
  if (symbol !== ticker) permanentRedirect(`/ticker/${encodeURIComponent(ticker)}`);
  const company = await loadCompanyResearch(ticker);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: `${company.name} (${ticker}) company research`, url: absoluteUrl(`/ticker/${ticker}`), description: companyResearchDescription(company) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "YouAnalyst", item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: "Companies", item: absoluteUrl("/companies") },
        { "@type": "ListItem", position: 3, name: ticker, item: absoluteUrl(`/ticker/${ticker}`) },
      ] },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <TickerPage ticker={ticker} overview={<CompanyResearchOverview company={company} fundamentals={
      <Suspense fallback={<p role="status" className="py-6 text-sm text-slate-400"><UiText text={"Loading SEC business and financials…"} /></p>}>
        <CompanyFundamentalsLoader ticker={ticker} />
      </Suspense>
    } />} />
  </>;
}

export async function generateMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args));
}
