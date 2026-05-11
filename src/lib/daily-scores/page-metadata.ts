import type { Metadata } from "next";
import { appendInstitutionalMoveSnapshotParams } from "@/lib/daily-scores/institutional-share-snapshot";
import {
  dailyCanonicalPath,
  dailyInstitutionalMoveSharePath,
  dailyInstitutionalMoveShareVersion,
  dailyShareImageDate,
  dailyShareVersion,
  type DailyInstitutionalMoveShareKind,
} from "@/lib/daily-scores/public-share";
import { getDailyScores, type DailyInstitutionalMove } from "@/lib/daily-scores/service";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function moveShareDescription(move: DailyInstitutionalMove, kind: DailyInstitutionalMoveShareKind): string {
  const verb = kind === "increase" ? "increased" : "reduced";
  const amount = kind === "increase" ? formatSignedCurrency(move.valueChangeUsd) : formatCurrency(Math.abs(move.valueChangeUsd));
  return `Latest 13F reports show ${move.ticker} ${verb} by ${amount} across ${move.managerCount} manager${move.managerCount === 1 ? "" : "s"} as of ${move.reportDate}.`;
}

function findInstitutionalMove(
  moves: Awaited<ReturnType<typeof getDailyScores>>["institutionalMoves"],
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
): DailyInstitutionalMove | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const items = kind === "increase" ? moves.increases : moves.decreases;
  return items.find((move) => move.ticker.toUpperCase() === normalizedTicker) ?? null;
}

function buildInstitutionalMoveMetadata(
  date: string,
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
  move: DailyInstitutionalMove | null,
): Metadata {
  const normalizedTicker = (move?.ticker ?? ticker).trim().toUpperCase();
  const title = `${normalizedTicker} 13F ${kind} | YouAnalyst`;
  const description = move
    ? moveShareDescription(move, kind)
    : `Latest institutional 13F ${kind} context for ${normalizedTicker} on YouAnalyst.`;
  const canonical = dailyInstitutionalMoveSharePath(date, kind, normalizedTicker);
  const version = dailyInstitutionalMoveShareVersion(date, kind, normalizedTicker);
  const imageParams = new URLSearchParams({
    date,
    kind,
    ticker: normalizedTicker,
    v: version,
  });
  if (move) {
    appendInstitutionalMoveSnapshotParams(imageParams, move);
  }
  const imagePath = `/api/daily-scores/institutional-share-image?${imageParams.toString()}`;

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [
        {
          url: imagePath,
          width: 1200,
          height: 630,
          type: "image/png",
          alt: `YouAnalyst ${normalizedTicker} institutional ${kind} share card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imagePath],
    },
  };
}

function buildDailyScoresMetadata(date: string | null, hasCallOfTheDay: boolean): Metadata {
  const title = date ? `Best Calls Today - ${date} | YouAnalyst` : "Daily score moves | YouAnalyst";
  const description = hasCallOfTheDay
    ? "See today's top public stock calls and daily performance moves on YouAnalyst."
    : "Track daily score changes and recent analyst performance moves on YouAnalyst.";
  const canonical = dailyCanonicalPath(date);
  const imageDate = dailyShareImageDate(date);
  const version = dailyShareVersion(date);
  const openGraphImage = `/daily/share/${imageDate}/opengraph-image?v=${version}`;
  const twitterImage = `/daily/share/${imageDate}/twitter-image?v=${version}`;

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [
        {
          url: openGraphImage,
          width: 1200,
          height: 630,
          alt: "YouAnalyst daily top call share card",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [twitterImage],
    },
  };
}

export async function dailyScoresMetadata(date: string | null): Promise<Metadata> {
  try {
    const result = await getDailyScores(date);
    return buildDailyScoresMetadata(result.date, Boolean(result.callOfTheDay));
  } catch {
    return buildDailyScoresMetadata(date, false);
  }
}

export async function dailyInstitutionalMoveMetadata(
  date: string,
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
  snapshot: DailyInstitutionalMove | null = null,
): Promise<Metadata> {
  try {
    const result = await getDailyScores(date);
    const move = findInstitutionalMove(result.institutionalMoves, kind, ticker) ?? snapshot;
    return buildInstitutionalMoveMetadata(result.date ?? date, kind, ticker, move);
  } catch {
    return buildInstitutionalMoveMetadata(date, kind, ticker, snapshot);
  }
}
