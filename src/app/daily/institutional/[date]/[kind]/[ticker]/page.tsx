import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DailyScoresPage } from "@/components/daily-scores-page";
import { dailyInstitutionalMoveMetadata } from "@/lib/daily-scores/page-metadata";
import { isDailyInstitutionalMoveShareKind } from "@/lib/daily-scores/public-share";
import { isDailyScoreDate } from "@/lib/daily-scores/service";

type Props = {
  params: Promise<{
    date: string;
    kind: string;
    ticker: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date, kind, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  return dailyInstitutionalMoveMetadata(date, kind, ticker);
}

export default async function DailyInstitutionalMoveSharePage({ params }: Props) {
  const { date, kind } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  return <DailyScoresPage initialDate={date} />;
}
