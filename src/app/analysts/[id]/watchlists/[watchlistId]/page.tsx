import { getAdminFirestore } from "@/lib/firebase/admin";
import { redirect } from "next/navigation";
import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { WatchlistDetailPage } from "@/components/watchlist-detail-page";
import { generatePublicWatchlistMetadata } from "@/lib/watchlists/public-page";

async function buildPageMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; watchlistId: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
}): Promise<Metadata> {
  const { watchlistId } = await params;
  const { share } = await searchParams;
  return generatePublicWatchlistMetadata(watchlistId, { share });
}

export default async function AnalystWatchlistPage({
  params,
}: {
  params: Promise<{ id: string; watchlistId: string }>;
}) {
  const { watchlistId } = await params;
  const group = await getAdminFirestore().collection("watchlists").doc(watchlistId).get();
  if (group.get("kind") === "COMPARISON") redirect("/compare");
  return <WatchlistDetailPage watchlistId={watchlistId} />;
}

export async function generateMetadata(...args: Parameters<typeof buildPageMetadata>) {
  return localizedMetadata(await buildPageMetadata(...args));
}
