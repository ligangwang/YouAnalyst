import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { CreatePredictionPage } from "@/components/create-prediction-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "New prediction | YouAnalyst",
  description: "Create a new public stock prediction on YouAnalyst.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function NewPredictionRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string | string[]; watchlistId?: string | string[]; direction?: string | string[] }>;
}) {
  const { ticker, watchlistId, direction } = await searchParams;
  const requestedTicker = Array.isArray(ticker) ? ticker[0] : ticker;
  const requestedWatchlistId = Array.isArray(watchlistId) ? watchlistId[0] : watchlistId;

  const requestedDirection = Array.isArray(direction) ? direction[0] : direction;
  return <CreatePredictionPage requestedTicker={requestedTicker ?? ""} requestedWatchlistId={requestedWatchlistId ?? ""} requestedDirection={requestedDirection === "DOWN" ? "DOWN" : requestedDirection === "UP" ? "UP" : undefined} />;
}
