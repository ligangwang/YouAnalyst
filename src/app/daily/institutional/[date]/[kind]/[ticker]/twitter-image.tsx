import { createDailyInstitutionalMoveShareImage, dailyShareCardContentType, dailyShareCardSize } from "@/lib/daily-scores/share-card";

export const size = dailyShareCardSize;
export const contentType = dailyShareCardContentType;

export default async function DailyInstitutionalMoveTwitterImage({
  params,
}: {
  params: Promise<{ date: string; kind: string; ticker: string }>;
}) {
  const { date, kind, ticker } = await params;
  return createDailyInstitutionalMoveShareImage(date, kind, ticker);
}
