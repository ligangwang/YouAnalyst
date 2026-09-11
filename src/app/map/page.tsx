import { ChinaSupplyChain } from "@/components/china-supply-chain";
import { AllMarketsOverview } from "@/components/all-markets-overview";
import { MapMarketSwitch } from "@/components/map-market-switch";
import type { Metadata } from "next";
import { IndustryGraphHome } from "@/components/industry-graph-home";
import { absoluteUrl } from "@/lib/seo";
import { headers } from "next/headers";
import { parseMarket } from "@/lib/preferences";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type MapSearchParams = { company?: string | string[]; market?: string | string[] };

export async function generateMetadata({ searchParams }: { searchParams: Promise<MapSearchParams> }): Promise<Metadata> {
  const { company, market } = await searchParams;
  const selected = parseMarket(market) ?? parseMarket((await headers()).get("x-ya-market")) ?? "US";
  if (selected === "CN_A") return localizedMetadata({ title: "A-share industries | YouAnalyst", description: "Explore reviewed A-share companies by business and industry, with links to original disclosures.", alternates: { canonical: "/map?market=CN_A" }, openGraph: { title: "A-share industries | YouAnalyst", url: "/map?market=CN_A" } });
  const nvidia = typeof company === "string" && company.toUpperCase() === "NVDA";
  const image = {
    url: absoluteUrl(`/map/share-image${nvidia ? "?company=NVDA&v=1" : "?v=1"}`),
    width: 1200,
    height: 630,
    alt: nvidia ? "NVIDIA ($NVDA) and Arista Networks ($ANET): networking competitors named in NVIDIA’s February 25, 2026 10-K." : "YouAnalyst: explore company connections and inspect filing evidence.",
  };
  return localizedMetadata({
    title: "Company relationship map | YouAnalyst",
    description: "Explore published company relationships and inspect filing evidence for suppliers, customers and competitors.",
    alternates: {
      canonical: "/map",
    },
    openGraph: {
      title: "Company relationship map | YouAnalyst",
      description: "Explore company connections through SEC filing evidence.",
      url: nvidia ? "/map?company=NVDA" : "/map",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      images: [image],
      title: "Company relationship map | YouAnalyst",
      description: "Explore company connections through SEC filing evidence.",
    },
  });
}

export default async function Home({ searchParams }: { searchParams: Promise<MapSearchParams> }) {
  const { company, market } = await searchParams;
  const ticker = typeof company === "string" ? company : "";
  const selected = parseMarket(market) ?? parseMarket((await headers()).get("x-ya-market")) ?? "US";
  return <><MapMarketSwitch selected={selected} />{selected === "ALL"
    ? <AllMarketsOverview><ChinaSupplyChain embedded /><IndustryGraphHome key={ticker} initialTicker={ticker} embedded /></AllMarketsOverview>
    : selected === "CN_A" ? <ChinaSupplyChain /> : <IndustryGraphHome key={ticker} initialTicker={ticker} />}</>;
}
