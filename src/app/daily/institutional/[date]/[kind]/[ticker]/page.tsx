import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { institutionalMoveFromShareParams } from "@/lib/daily-scores/institutional-share-snapshot";
import { dailyInstitutionalMoveMetadata } from "@/lib/daily-scores/page-metadata";
import { isDailyInstitutionalMoveShareKind } from "@/lib/daily-scores/public-share";
import { DailyInstitutionalMoveShareView } from "@/lib/daily-scores/institutional-share-page";
import { isDailyScoreDate } from "@/lib/daily-scores/service";

type Props = {
  params: Promise<{
    date: string;
    kind: string;
    ticker: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { date, kind, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  const snapshot = institutionalMoveFromShareParams(await searchParams, ticker);
  return dailyInstitutionalMoveMetadata(date, kind, ticker, snapshot);
}

export default async function DailyInstitutionalMoveSharePage({ params, searchParams }: Props) {
  const { date, kind, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  const snapshot = institutionalMoveFromShareParams(await searchParams, ticker);
  return <DailyInstitutionalMoveShareView date={date} kind={kind} snapshot={snapshot} ticker={ticker} />;
}
