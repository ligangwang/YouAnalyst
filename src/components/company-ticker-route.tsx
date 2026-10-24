import { CompanyResearchTimeline } from "./company-timeline";
import type { CompanyResearch } from "@/lib/company-research";
import type { KnowledgeGraph, GraphNode } from "@/lib/knowledge-graph/model";
import { CompanyResearchPanel } from "./company-research-panel";
import { loadCompanyFundamentals } from "@/lib/fundamentals/service";
import type { ResolvedCompany } from "@/lib/company-research-service";
import { CompanyClassifications } from './company-classifications';
import { readCompanyLookup } from "@/lib/company-lookup-cache";
import { companyName } from "@/lib/knowledge-graph/model";
import { localizedPath } from "@/lib/ui/i18n/urls";
import {withCompanyPageReads} from "@/lib/local-cache/company-page-scope";
import { localizedMetadata } from "@/lib/ui/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CompanyFundamentalsLoader } from "@/components/company-fundamentals-loader";
import { CompanyPeerComparisonLoader } from '@/components/company-peer-comparison-loader';
import { TickerPage } from "@/components/ticker-page";
import { normalizeTicker } from "@/lib/predictions/types";
import { notFound, permanentRedirect } from "next/navigation";
import { loadCompanyPageGraph, loadCompanyResearch } from "@/lib/company-research-service";
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

const loadCompanyEarnings=cache(loadLatestCompanyEarnings);
const loadChinaCompany = cache((id: string) => withCompanyPageReads(async()=>{
  const db = getAdminFirestore();
  const doc = await readCompanyLookup(db, db.collection(COMPANY_COLLECTION).doc(id));
  const company = doc.exists ? publicChinaCompany(doc.id, doc.data()!) : null;
  if (!company) notFound();
  return company;
}));

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
  params, resolved,
}: {
  params: Promise<{ symbol: string }>; resolved?: ResolvedCompany;
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
  const company = await loadCompanyResearch(ticker,resolved);
  const [canonicalPath,earnings]=await Promise.all([resolved?.path ?? canonicalCompanyPath(`US:${ticker}`),company.inMap?loadCompanyEarnings(`US:${ticker}`):null]);
  const canonical = canonicalPath ?? companyPageUrl(ticker,'US',company.slug);
  const content = { earnings: Boolean(earnings) };
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

export async function CompanyTickerContent({ params, resolved }: { params: Promise<{ symbol: string }>; resolved?: ResolvedCompany }) {
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const { symbol: rawSymbol } = await params;
  const symbol = decodeRouteSymbol(rawSymbol);
  const chinaId = chinaCompanyId(symbol);
  if (chinaId) {
    if (symbol !== chinaId) permanentRedirect(companyPageUrl(chinaId, "CN_A"));
    const [company, fundamentals,announcements,earningsSummary] = await Promise.all([loadChinaCompany(chinaId), loadCnFundamentals(chinaId),loadCompanyAnnouncements(chinaId),loadCompanyEarnings(chinaId)]);
    const url = absoluteUrl(localizedPath(companyPageUrl(chinaId, "CN_A",company.slug), locale));
    const schema = { "@context": "https://schema.org", ...companyOrganizationSchema(company, locale, url, chinaId.split(":")[1], chinaId.startsWith("XSHG:") ? "SSE" : "SZSE") };
    return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /><ChinaCompanyPage classifications={<Suspense fallback={null}><CompanyClassifications companyId={chinaId}/></Suspense>} company={company} marketCap={fundamentals?.marketCap} annual={fundamentals?.annual} stale={fundamentals?.stale} announcements={announcements} earningsSummary={earningsSummary} comparison={<Suspense fallback={null}><CompanyPeerComparisonLoader companyId={chinaId}/></Suspense>} /></>;
  }
  const ticker = resolveTicker(symbol);
  if (symbol !== ticker) permanentRedirect(localizedPath(companyPageUrl(ticker, "US"), locale));
  const fundamentals=loadCompanyFundamentals(ticker);
  // Observe rejection while the financial component waits for its boundary.
  void fundamentals.catch(()=>undefined);
  const company = await loadCompanyResearch(ticker,resolved);
  const [canonicalPath,earningsSummary,announcements]=await Promise.all([
    resolved?.path ?? canonicalCompanyPath(`US:${ticker}`),company.inMap?loadCompanyEarnings(`US:${ticker}`):null,
    company.inMap?loadCompanyAnnouncements(`US:${ticker}`):[],
  ]);
  const canonical = canonicalPath ?? companyPageUrl(ticker,'US',company.slug);
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
    <TickerPage ticker={ticker} overview={<CompanyResearchOverview classifications={<Suspense fallback={null}><CompanyClassifications companyId={`US:${ticker}`} data={resolved?.data}/></Suspense>} company={company} announcements={announcements} earningsSummary={earningsSummary} timeline={<Suspense fallback={null}><CompanyTimeline company={company} graph={company.neighborhood ?? undefined} pending={fundamentals}/></Suspense>} graphContent={company.inMap || !company.graphAvailable ? <Suspense fallback={null}><CompanyGraph companyId={`US:${ticker}`}/></Suspense> : undefined} fundamentals={
      <Suspense fallback={<p role="status" className="py-6 text-sm text-slate-400"><UiText text={"Loading SEC business and financials…"} /></p>}>
        <CompanyFundamentalsLoader ticker={ticker} pending={fundamentals} />
      </Suspense>
    } comparison={<Suspense fallback={null}><CompanyPeerComparisonLoader companyId={`US:${ticker}`} company={resolved?.data} aiEligible={company.graphAvailable ? company.inMap : undefined}/></Suspense>} />} />
  </>;
}

export async function companyTickerMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args), { usePageCanonical: true });
}

async function CompanyGraph({companyId}:{companyId:string}) {
 const graph=await loadCompanyPageGraph().catch(()=>undefined);
 return <CompanyResearchPanel companyId={companyId} initialGraph={graph}/>;
}

async function CompanyTimeline({company,graph,pending}:{company:CompanyResearch;graph?:KnowledgeGraph;pending:ReturnType<typeof loadCompanyFundamentals>}) {
 const financials=await pending.catch(()=>null), cap=financials?.marketCap;
 const node:GraphNode=graph?.nodes.find(node=>node.id===`US:${company.ticker}`) ?? {
  id:`US:${company.ticker}`,kind:'COMPANY',order:0,name:company.name,names:company.names,
  symbol:company.ticker,country:company.country ?? undefined,market:'US',listingStatus:company.listingStatus==='PRIVATE'?'PRIVATE':'PUBLIC',
 };
 const marketCap=cap?.status==='estimated' && cap.currency==='USD' && typeof cap.value==='number' && Number.isFinite(cap.value) && cap.value>0 && /^\d{4}-\d{2}-\d{2}$/.test(cap.priceDate ?? '')
  ? {value:cap.value,currency:'USD' as const,priceDate:cap.priceDate!}:undefined;
 return <CompanyResearchTimeline company={{...node,marketCap}} graph={graph}/>;
}
