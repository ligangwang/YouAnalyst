import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { WatchlistsPage } from "@/components/watchlists-page";
import { listPublicWatchlists } from "@/lib/watchlists/service";

export const dynamic = "force-dynamic";

const pageMetadata: Metadata = {
  title: "Watchlists | YouAnalyst",
  description: "Browse community watchlists and manage your own watchlists on YouAnalyst.",
  alternates: {
    canonical: "/watchlists",
  },
  openGraph: {
    title: "Watchlists | YouAnalyst",
    description: "Browse community watchlists and manage your own watchlists on YouAnalyst.",
    url: "/watchlists",
  },
  twitter: {
    title: "Watchlists | YouAnalyst",
    description: "Browse community watchlists and manage your own watchlists on YouAnalyst.",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function WatchlistsRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const watchlists = await listPublicWatchlists();
  const { tab } = await searchParams;
  const initialTab = Array.isArray(tab) ? tab[0] : tab;

  return <WatchlistsPage publicWatchlists={watchlists} initialTab={initialTab} />;
}
