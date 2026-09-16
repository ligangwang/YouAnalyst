import type { Metadata } from "next";
import { AiKnowledgeGraph } from "@/components/ai-knowledge-graph";
import { redirect } from "next/navigation";
import { localizedMetadata } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
type MapSearchParams = { event?: string | string[]; relationship?: string | string[]; company?: string | string[]; market?: string | string[]; q?: string | string[]; view?: string | string[] };
export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({ title: "AI Industry Map: AI Stocks & Companies | YouAnalyst", description: "Explore AI stocks, companies, and supply-chain relationships across US and China A-share markets.", alternates: { canonical: "/" } });
}
export default async function Home({ searchParams }: { searchParams: Promise<MapSearchParams> }) {
  const { company, view, q, event, relationship } = await searchParams;
  if (view === "filings") redirect("/feed");
  return <AiKnowledgeGraph key={JSON.stringify([company,event,relationship])} initialEvent={typeof event === "string" ? event : ""} initialEdge={typeof relationship === "string" ? relationship : ""} initialCompany={typeof company === "string" ? company : ""} initialQuery={typeof q === "string" ? q : ""} />;
}
