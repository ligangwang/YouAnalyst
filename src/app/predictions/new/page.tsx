import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { CreatePredictionPage } from "@/components/create-prediction-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Publish a view | YouAnalyst",
  description: "Publish an evidence-backed analyst view on a map company.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function NewPredictionRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string | string[]; watchlistId?: string | string[]; direction?: string | string[]; relationship?: string | string[] }>;
}) {
  const { ticker, watchlistId, direction, relationship } = await searchParams;
  const requestedTicker = Array.isArray(ticker) ? ticker[0] : ticker;
  const requestedWatchlistId = Array.isArray(watchlistId) ? watchlistId[0] : watchlistId;

  const requestedDirection = Array.isArray(direction) ? direction[0] : direction;
  return <CreatePredictionPage requestedTicker={requestedTicker ?? ""} requestedWatchlistId={requestedWatchlistId ?? ""} requestedDirection={requestedDirection === "DOWN" ? "DOWN" : requestedDirection === "UP" ? "UP" : undefined} requestedRelationship={typeof relationship === "string" ? relationship : ""} />;
}
