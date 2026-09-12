import type { Metadata } from "next";
import { AiKnowledgeGraph } from "@/components/ai-knowledge-graph";
import { IndustryGraphHome } from "@/components/industry-graph-home";
import { parseMarket } from "@/lib/preferences";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
type MapSearchParams = { company?: string | string[]; market?: string | string[]; view?: string | string[] };
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "Company graph | YouAnalyst", description: "Explore US-listed and A-share companies together across the AI supply chain, with documented relationships and original sources.", alternates: { canonical: "/map" } });
}
export default async function Home({ searchParams }: { searchParams: Promise<MapSearchParams> }) {
  const { company, market, view } = await searchParams;
  if (view === "filings") return <IndustryGraphHome initialTicker={typeof company === "string" ? company : ""} />;
  const selected = market === "NONE" ? "NONE" : parseMarket(market) ?? "ALL";
  return <AiKnowledgeGraph key={selected} initialMarket={selected} initialCompany={typeof company === "string" ? company : ""} />;
}
