import {
  institutionalMoveFromSnapshotSegment,
} from "@/lib/daily-scores/institutional-share-snapshot";
import { createDailyInstitutionalMoveShareImage, dailyShareCardContentType, dailyShareCardSize } from "@/lib/daily-scores/share-card";

export const size = dailyShareCardSize;
export const contentType = dailyShareCardContentType;

export default async function DailyInstitutionalMoveSnapshotOpenGraphImage({
  params,
}: {
  params: Promise<{ date: string; kind: string; snapshot: string; ticker: string }>;
}) {
  const { date, kind, snapshot, ticker } = await params;
  return createDailyInstitutionalMoveShareImage(date, kind, ticker, institutionalMoveFromSnapshotSegment(snapshot, ticker));
}
