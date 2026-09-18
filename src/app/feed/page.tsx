import { FollowedCompaniesPage } from "@/components/followed-companies-page";
import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LiveEventFeed, LiveFeedLoading } from "@/components/live-event-feed";
import { listPublicEvents } from "@/lib/events/service";
import { parseEventFilter, type EventFilter } from "@/lib/events/filters";
import { FILING_FEATURES_ENABLED } from "@/lib/feature-flags";
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
  const { company, type: rawType, scope } = await searchParams;
  if (scope === "following") return <FollowedCompaniesPage feed />;
  const ticker = typeof company === "string" ? company : "";
  if (ticker) redirect(`/map?company=${encodeURIComponent(ticker)}`);
  if (!FILING_FEATURES_ENABLED) {
    const graph = await loadKnowledgeGraph().catch(() => null);
    const items = graph ? companyUpdates(graph, graph.nodes.filter(n => n.kind === "COMPANY").map(n => n.id), [], curatedEvents) : [];
    return <ResearchUpdateFeed graph={graph} items={items} />;
  }
  let type: EventFilter;
  try { type = parseEventFilter(rawType); } catch { redirect("/feed"); }
  return <Suspense key={type} fallback={<LiveFeedLoading />}><InitialFeed type={type} /></Suspense>;
}

async function InitialFeed({ type }: { type: EventFilter }) {
  const initial = await listPublicEvents({ type }).then(page => ({ page, error: false }))
    .catch(() => ({ page: { items: [], nextCursor: null }, error: true }));
  return <LiveEventFeed key={type} type={type} initialPage={initial.page} initialError={initial.error} />;
}
