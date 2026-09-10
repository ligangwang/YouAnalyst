import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LiveEventFeed, LiveFeedLoading } from "@/components/live-event-feed";
import { listPublicEvents } from "@/lib/events/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live market feed | YouAnalyst",
  description: "Follow the latest SEC filings and company developments in a calm, live market feed.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Live market feed | YouAnalyst",
    description: "Source-linked market developments, delivered as they arrive.",
    url: "/",
  },
  twitter: {
    title: "Live market feed | YouAnalyst",
    description: "Source-linked market developments, delivered as they arrive.",
  },
};

export default async function Home({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  const { company } = await searchParams;
  const ticker = typeof company === "string" ? company : "";
  if (ticker) redirect(`/map?company=${encodeURIComponent(ticker)}`);
  return <Suspense fallback={<LiveFeedLoading />}><InitialFeed /></Suspense>;
}

async function InitialFeed() {
  const initial = await listPublicEvents().then(page => ({ page, error: false }))
    .catch(() => ({ page: { items: [], nextCursor: null }, error: true }));
  return <LiveEventFeed initialPage={initial.page} initialError={initial.error} />;
}
