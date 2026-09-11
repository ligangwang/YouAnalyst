import type { Metadata } from "next";
import { AiKnowledgeGraph } from "@/components/ai-knowledge-graph";
import { parseMarket } from "@/lib/preferences";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
type MapSearchParams = { company?: string | string[]; market?: string | string[] };
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "AI knowledge graph | YouAnalyst", description: "Explore US-listed and A-share companies together across the AI supply chain, with documented relationships and original sources.", alternates: { canonical: "/map" } });
}
export default async function Home({ searchParams }: { searchParams: Promise<MapSearchParams> }) {
  const { company, market } = await searchParams;
  const selected = market === "NONE" ? "NONE" : parseMarket(market) ?? "ALL";
  return <AiKnowledgeGraph key={selected} initialMarket={selected} initialCompany={typeof company === "string" ? company : ""} />;
}
