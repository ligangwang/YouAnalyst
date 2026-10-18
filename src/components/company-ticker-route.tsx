import { companyName } from "@/lib/knowledge-graph/model";
import { localizedPath } from "@/lib/ui/i18n/urls";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
import { localizedMetadata } from "@/lib/ui/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CompanyFundamentalsLoader } from "@/components/company-fundamentals-loader";
import { CompanyPeerComparisonLoader } from '@/components/company-peer-comparison-loader';
import { TickerPage } from "@/components/ticker-page";
import { normalizeTicker } from "@/lib/predictions/types";
import { notFound, permanentRedirect } from "next/navigation";
import { loadCompanyResearch } from "@/lib/company-research-service";
import { companyPageHeadline, companyResearchDescription } from "@/lib/company-research";
import { CompanyResearchOverview } from "@/components/company-research-overview";
import {loadCompanyAnnouncements} from '@/lib/events/company-announcements';
import {loadLatestCompanyEarnings} from '@/lib/earnings/public-service';
import { absoluteUrl } from "@/lib/seo";
import { cache } from "react";
import { chinaCompanyId, companyPageUrl } from "@/lib/market-companies/routes";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { COMPANY_COLLECTION } from "@/lib/market-companies/model";
import { publicChinaCompany } from "@/lib/industry-research/china-directory";
import { ChinaCompanyPage } from "@/components/china-company-page";
import { loadCnFundamentals } from "@/lib/fundamentals/cn-service";
import { headers } from "next/headers";
import { companyOrganizationSchema } from "@/lib/company-schema";
import { canonicalCompanyPath } from "@/lib/market-companies/slug-resolver";

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
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const { symbol: rawSymbol } = await params;
  const symbol = decodeRouteSymbol(rawSymbol);
  const chinaId = chinaCompanyId(symbol);
  if (chinaId) {
    const company = await loadChinaCompany(chinaId);
    return { title: `${companyName({...company, names: {...company.names, en: company.names?.en || company.en}}, locale)} (${chinaId.split(":")[1]}) ${locale === "zh-CN" ? "股票：财务与分析师观点" : "Stock: Financials & Analyst Views"} | YouAnalyst`, description: locale === "en" ? company.descriptionEn || company.description : company.description,
      alternates: { canonical: companyPageUrl(chinaId, "CN_A",company.slug) } };
  }
  const ticker = resolveTicker(symbol);
  const company = await loadCompanyResearch(ticker);
  const canonical = await canonicalCompanyPath(`US:${ticker}`) ?? companyPageUrl(ticker,'US',company.slug);
  // Cached per company, so the page render reuses this read.
  const content = { earnings: company.inMap && Boolean(await loadLatestCompanyEarnings(`US:${ticker}`)) };
  const title = `${companyPageHeadline(company, locale, content)} | YouAnalyst`;
  const description = companyResearchDescription(company, locale, content);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      images: [{url:`/api/research-preview-image?company=US%3A${ticker}`,width:1200,height:630}],
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      images: [`/api/research-preview-image?company=US%3A${ticker}`],
      title,
      description,
    },
  };
}

export async function CompanyTickerContent({ params }: { params: Promise<{ symbol: string }> }) {
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const { symbol: rawSymbol } = await params;
  const symbol = decodeRouteSymbol(rawSymbol);
  const chinaId = chinaCompanyId(symbol);
  if (chinaId) {
    if (symbol !== chinaId) permanentRedirect(companyPageUrl(chinaId, "CN_A"));
    const [company, fundamentals] = await Promise.all([loadChinaCompany(chinaId), loadCnFundamentals(chinaId)]);
    const url = absoluteUrl(localizedPath(companyPageUrl(chinaId, "CN_A",company.slug), locale));
    const schema = { "@context": "https://schema.org", ...companyOrganizationSchema(company, locale, url, chinaId.split(":")[1], chinaId.startsWith("XSHG:") ? "SSE" : "SZSE") };
    return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /><ChinaCompanyPage company={company} marketCap={fundamentals?.marketCap} annual={fundamentals?.annual} stale={fundamentals?.stale} announcements={await loadCompanyAnnouncements(chinaId)} earningsSummary={await loadLatestCompanyEarnings(chinaId)} comparison={<Suspense fallback={null}><CompanyPeerComparisonLoader companyId={chinaId}/></Suspense>} /></>;
  }
  const ticker = resolveTicker(symbol);
  if (symbol !== ticker) permanentRedirect(localizedPath(companyPageUrl(ticker, "US"), locale));
  const company = await loadCompanyResearch(ticker);
  const canonical = await canonicalCompanyPath(`US:${ticker}`) ?? companyPageUrl(ticker,'US',company.slug);
  const earningsSummary = company.inMap ? await loadLatestCompanyEarnings(`US:${ticker}`) : null;
  const content = { earnings: Boolean(earningsSummary) };
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      ...(company.known ? [companyOrganizationSchema({ ...company, id: `US:${ticker}` }, locale, absoluteUrl(localizedPath(canonical, locale)), ticker, company.exchange)] : []),
      { "@type": "WebPage", name: companyPageHeadline(company, locale, content), url: absoluteUrl(localizedPath(canonical, locale)), description: companyResearchDescription(company, locale, content) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "YouAnalyst", item: absoluteUrl(localizedPath("/", locale)) },
        { "@type": "ListItem", position: 2, name: locale === "zh-CN" ? "公司" : "Companies", item: absoluteUrl(localizedPath("/companies", locale)) },
        { "@type": "ListItem", position: 3, name: ticker, item: absoluteUrl(localizedPath(canonical, locale)) },
      ] },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <TickerPage ticker={ticker} overview={<CompanyResearchOverview company={company} announcements={company.inMap?await loadCompanyAnnouncements(`US:${ticker}`):[]} earningsSummary={earningsSummary} graph={await loadKnowledgeGraph().catch(() => undefined)} fundamentals={
      <Suspense fallback={<p role="status" className="py-6 text-sm text-slate-400"><UiText text={"Loading SEC business and financials…"} /></p>}>
        <CompanyFundamentalsLoader ticker={ticker} />
      </Suspense>
    } comparison={<Suspense fallback={null}><CompanyPeerComparisonLoader companyId={`US:${ticker}`}/></Suspense>} />} />
  </>;
}

export async function companyTickerMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args), { usePageCanonical: true });
}
