import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DailyInsiderMoveShareView } from "@/lib/daily-scores/insider-share-page";
import {
  insiderMoveFromSnapshotSegment,
  insiderMoveSnapshotSegment,
} from "@/lib/daily-scores/insider-share-snapshot";
import { dailyInsiderMoveMetadata } from "@/lib/daily-scores/page-metadata";
import { dailyInsiderMoveSharePath, isDailyInsiderMoveShareKind } from "@/lib/daily-scores/public-share";
import { isDailyScoreDate } from "@/lib/daily-scores/service";

type Props = {
  params: Promise<{
    date: string;
    kind: string;
    snapshot: string;
    ticker: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date, kind, snapshot, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInsiderMoveShareKind(kind)) {
    notFound();
  }

  const move = insiderMoveFromSnapshotSegment(snapshot, ticker);
  const canonicalPath = move
    ? `${dailyInsiderMoveSharePath(date, kind, ticker)}/${insiderMoveSnapshotSegment(move)}`
    : null;

  return dailyInsiderMoveMetadata(date, kind, ticker, move, canonicalPath);
}

export default async function DailyInsiderMoveSnapshotSharePage({ params }: Props) {
  const { date, kind, snapshot, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInsiderMoveShareKind(kind)) {
    notFound();
  }

  const move = insiderMoveFromSnapshotSegment(snapshot, ticker);
  return <DailyInsiderMoveShareView date={date} kind={kind} snapshot={move} ticker={ticker} />;
}
