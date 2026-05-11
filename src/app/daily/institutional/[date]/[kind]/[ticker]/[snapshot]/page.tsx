import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  institutionalMoveFromSnapshotSegment,
  institutionalMoveSnapshotSegment,
} from "@/lib/daily-scores/institutional-share-snapshot";
import { DailyInstitutionalMoveShareView } from "@/lib/daily-scores/institutional-share-page";
import { dailyInstitutionalMoveMetadata } from "@/lib/daily-scores/page-metadata";
import { dailyInstitutionalMoveSharePath, isDailyInstitutionalMoveShareKind } from "@/lib/daily-scores/public-share";
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
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  const move = institutionalMoveFromSnapshotSegment(snapshot, ticker);
  const canonicalPath = move
    ? `${dailyInstitutionalMoveSharePath(date, kind, ticker)}/${institutionalMoveSnapshotSegment(move)}`
    : null;

  return dailyInstitutionalMoveMetadata(date, kind, ticker, move, canonicalPath);
}

export default async function DailyInstitutionalMoveSnapshotSharePage({ params }: Props) {
  const { date, kind, snapshot, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  const move = institutionalMoveFromSnapshotSegment(snapshot, ticker);
  return <DailyInstitutionalMoveShareView date={date} kind={kind} snapshot={move} ticker={ticker} />;
}
