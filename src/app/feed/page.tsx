import { FollowedCompaniesPage } from "@/components/followed-companies-page";
import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
import { companyUpdates } from "@/lib/knowledge-graph/company-updates";
import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import { ResearchUpdateFeed } from "@/components/research-update-feed";

export const dynamic = "force-dynamic";

const pageMetadata: Metadata = {
  title: "Company research updates | YouAnalyst",
  description: "Explore sourced AI supply-chain developments and research evidence updates.",
  alternates: {
    canonical: "/feed",
  },
  openGraph: {
    title: "Company research updates | YouAnalyst",
    description: "Explore sourced AI supply-chain developments and research evidence updates.",
    url: "/feed",
  },
  twitter: {
    title: "Company research updates | YouAnalyst",
    description: "Explore sourced AI supply-chain developments and research evidence updates.",
  },
};

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function Home({ searchParams }: { searchParams: Promise<{ company?: string | string[]; type?: string | string[]; scope?: string | string[] }> }) {
  const { company, scope } = await searchParams;
  if (scope === "following") return <FollowedCompaniesPage feed />;
  const ticker = typeof company === "string" ? company : "";
  if (ticker) redirect(`/map?company=${encodeURIComponent(ticker)}`);
  {
    const graph = await loadKnowledgeGraph().catch(() => null);
    const items = graph ? companyUpdates(graph, graph.nodes.filter(n => n.kind === "COMPANY").map(n => n.id), curatedEvents) : [];
    return <ResearchUpdateFeed graph={graph} items={items} />;
  }
}
