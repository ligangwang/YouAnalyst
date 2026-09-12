import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LiveEventFeed, LiveFeedLoading } from "@/components/live-event-feed";
import { listPublicEvents } from "@/lib/events/service";
import { parseEventFilter, type EventFilter } from "@/lib/events/filters";

export const dynamic = "force-dynamic";

const pageMetadata: Metadata = {
  title: "Live market feed | YouAnalyst",
  description: "Follow the latest SEC filings and company developments in a calm, live market feed.",
  alternates: {
    canonical: "/feed",
  },
  openGraph: {
    title: "Live market feed | YouAnalyst",
    description: "Source-linked market developments, delivered as they arrive.",
    url: "/feed",
  },
  twitter: {
    title: "Live market feed | YouAnalyst",
    description: "Source-linked market developments, delivered as they arrive.",
  },
};

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function Home({ searchParams }: { searchParams: Promise<{ company?: string | string[]; type?: string | string[] }> }) {
  const { company, type: rawType } = await searchParams;
  const ticker = typeof company === "string" ? company : "";
  if (ticker) redirect(`/map?company=${encodeURIComponent(ticker)}`);
  let type: EventFilter;
  try { type = parseEventFilter(rawType); } catch { redirect("/feed"); }
  return <Suspense key={type} fallback={<LiveFeedLoading />}><InitialFeed type={type} /></Suspense>;
}

async function InitialFeed({ type }: { type: EventFilter }) {
  const initial = await listPublicEvents({ type }).then(page => ({ page, error: false }))
    .catch(() => ({ page: { items: [], nextCursor: null }, error: true }));
  return <LiveEventFeed key={type} type={type} initialPage={initial.page} initialError={initial.error} />;
}
