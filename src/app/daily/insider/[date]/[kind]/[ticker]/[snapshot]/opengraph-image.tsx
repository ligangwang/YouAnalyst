import { insiderMoveFromSnapshotSegment } from "@/lib/daily-scores/insider-share-snapshot";
import { createDailyInsiderMoveShareImage, dailyShareCardContentType, dailyShareCardSize } from "@/lib/daily-scores/share-card";

export const size = dailyShareCardSize;
export const contentType = dailyShareCardContentType;

export default async function DailyInsiderMoveSnapshotOpenGraphImage({
  params,
}: {
  params: Promise<{ date: string; kind: string; snapshot: string; ticker: string }>;
}) {
  const { date, kind, snapshot, ticker } = await params;
  return createDailyInsiderMoveShareImage(date, kind, ticker, insiderMoveFromSnapshotSegment(snapshot, ticker));
}
