import type { Metadata } from "next";
import { AiKnowledgeGraph } from "@/components/ai-knowledge-graph";
import { IndustryGraphHome } from "@/components/industry-graph-home";
import { parseMarket } from "@/lib/preferences";
import { localizedMetadata } from "@/lib/i18n/server";
import { Suspense } from "react";
import { AiMapDirectory } from "@/components/ai-map-directory";

export const dynamic = "force-dynamic";
type MapSearchParams = { company?: string | string[]; market?: string | string[]; q?: string | string[]; view?: string | string[] };
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "AI Industry Map: AI Stocks & Companies | YouAnalyst", description: "Explore AI stocks, companies, and supply-chain relationships across US and China A-share markets.", alternates: { canonical: "/" } });
}
export default async function Home({ searchParams }: { searchParams: Promise<MapSearchParams> }) {
  const { company, market, view, q } = await searchParams;
  if (view === "filings") return <IndustryGraphHome initialTicker={typeof company === "string" ? company : ""} />;
  const selected = market === "NONE" ? "NONE" : parseMarket(market) ?? "ALL";
  return <><AiKnowledgeGraph initialMarket={selected} initialCompany={typeof company === "string" ? company : ""} initialQuery={typeof q === "string" ? q : ""} /><Suspense><AiMapDirectory /></Suspense></>;
}
