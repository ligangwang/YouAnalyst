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

export const dynamic = "force-dynamic";

function resolveTicker(symbol: string) {
  const ticker = normalizeTicker(symbol.replace(/^\$/, ""));
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) notFound();
  return ticker;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
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
  const { symbol } = await params;
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
      <Suspense fallback={<p role="status" className="py-6 text-sm text-slate-400">Loading SEC business and financials…</p>}>
        <CompanyFundamentalsLoader ticker={ticker} />
      </Suspense>
    } />} />
  </>;
}
