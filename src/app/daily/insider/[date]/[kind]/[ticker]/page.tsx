import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DailyInsiderMoveShareView } from "@/lib/daily-scores/insider-share-page";
import { dailyInsiderMoveMetadata } from "@/lib/daily-scores/page-metadata";
import { isDailyInsiderMoveShareKind } from "@/lib/daily-scores/public-share";
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
  if (!isDailyScoreDate(date) || !isDailyInsiderMoveShareKind(kind)) {
    notFound();
  }

  return dailyInsiderMoveMetadata(date, kind, ticker);
}

export default async function DailyInsiderMoveSharePage({ params }: Props) {
  const { date, kind, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInsiderMoveShareKind(kind)) {
    notFound();
  }

  return <DailyInsiderMoveShareView date={date} kind={kind} snapshot={null} ticker={ticker} />;
}
