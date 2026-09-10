import type { Metadata } from "next";
import { IndustryGraphHome } from "@/components/industry-graph-home";
import { absoluteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

type MapSearchParams = { company?: string | string[] };

export async function generateMetadata({ searchParams }: { searchParams: Promise<MapSearchParams> }): Promise<Metadata> {
  const { company } = await searchParams;
  const nvidia = typeof company === "string" && company.toUpperCase() === "NVDA";
  const image = {
    url: absoluteUrl(`/map/share-image${nvidia ? "?company=NVDA&v=1" : "?v=1"}`),
    width: 1200,
    height: 630,
    alt: nvidia ? "NVIDIA ($NVDA) and Arista Networks ($ANET): networking competitors named in NVIDIA’s February 25, 2026 10-K." : "YouAnalyst: explore company connections and inspect filing evidence.",
  };
  return {
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
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  const { company } = await searchParams;
  const ticker = typeof company === "string" ? company : "";
  return <IndustryGraphHome key={ticker} initialTicker={ticker} />;
}
