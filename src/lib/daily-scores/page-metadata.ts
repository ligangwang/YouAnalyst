import type { Metadata } from "next";
import { insiderMoveSnapshotSegment } from "@/lib/daily-scores/insider-share-snapshot";
import { institutionalMoveSnapshotSegment } from "@/lib/daily-scores/institutional-share-snapshot";
import {
  dailyCanonicalPath,
  dailyInsiderMoveSharePath,
  dailyInsiderMoveShareVersion,
  dailyInstitutionalMoveSharePath,
  dailyInstitutionalMoveShareVersion,
  dailyShareImageDate,
  dailyShareVersion,
  type DailyInsiderMoveShareKind,
  type DailyInstitutionalMoveShareKind,
} from "@/lib/daily-scores/public-share";
import { getDailyScores, type DailyInsiderMove, type DailyInstitutionalMove } from "@/lib/daily-scores/service";

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

function insiderMoveShareDescription(move: DailyInsiderMove, kind: DailyInsiderMoveShareKind): string {
  const noun = kind === "purchase" ? "purchases" : "sales";
  return `Latest Form 4 reports show ${move.ticker} insider ${noun} totaling ${formatCurrency(move.totalValueUsd)} across ${move.insiderCount} insider${move.insiderCount === 1 ? "" : "s"}, filed ${move.filingDate}.`;
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

function findInsiderMove(
  moves: Awaited<ReturnType<typeof getDailyScores>>["insiderMoves"],
  kind: DailyInsiderMoveShareKind,
  ticker: string,
): DailyInsiderMove | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const items = kind === "purchase" ? moves.purchases : moves.sales;
  return items.find((move) => move.ticker.toUpperCase() === normalizedTicker) ?? null;
}

function buildInstitutionalMoveMetadata(
  date: string,
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
  move: DailyInstitutionalMove | null,
  canonicalOverride: string | null = null,
): Metadata {
  const normalizedTicker = (move?.ticker ?? ticker).trim().toUpperCase();
  const title = `${normalizedTicker} 13F ${kind} | YouAnalyst`;
  const description = move
    ? moveShareDescription(move, kind)
    : `Latest institutional 13F ${kind} context for ${normalizedTicker} on YouAnalyst.`;
  const canonical = canonicalOverride ?? dailyInstitutionalMoveSharePath(date, kind, normalizedTicker);
  const version = dailyInstitutionalMoveShareVersion(date, kind, normalizedTicker);
  const imageBasePath = canonicalOverride ?? (move ? `${canonical}/${institutionalMoveSnapshotSegment(move)}` : canonical);
  const openGraphImage = `${imageBasePath}/opengraph-image?v=${version}`;
  const twitterImage = `${imageBasePath}/twitter-image?v=${version}`;

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
          type: "image/png",
          alt: `YouAnalyst ${normalizedTicker} institutional ${kind} share card`,
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

function buildInsiderMoveMetadata(
  date: string,
  kind: DailyInsiderMoveShareKind,
  ticker: string,
  move: DailyInsiderMove | null,
  canonicalOverride: string | null = null,
): Metadata {
  const normalizedTicker = (move?.ticker ?? ticker).trim().toUpperCase();
  const title = `${normalizedTicker} insider ${kind} | YouAnalyst`;
  const description = move
    ? insiderMoveShareDescription(move, kind)
    : `Latest insider ${kind} context for ${normalizedTicker} on YouAnalyst.`;
  const canonical = canonicalOverride ?? dailyInsiderMoveSharePath(date, kind, normalizedTicker);
  const version = dailyInsiderMoveShareVersion(date, kind, normalizedTicker);
  const imageBasePath = canonicalOverride ?? (move ? `${canonical}/${insiderMoveSnapshotSegment(move)}` : canonical);
  const openGraphImage = `${imageBasePath}/opengraph-image?v=${version}`;
  const twitterImage = `${imageBasePath}/twitter-image?v=${version}`;

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
          type: "image/png",
          alt: `YouAnalyst ${normalizedTicker} insider ${kind} share card`,
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
  canonicalPath: string | null = null,
): Promise<Metadata> {
  try {
    const result = await getDailyScores(date);
    const move = findInstitutionalMove(result.institutionalMoves, kind, ticker) ?? snapshot;
    return buildInstitutionalMoveMetadata(result.date ?? date, kind, ticker, move, canonicalPath);
  } catch {
    return buildInstitutionalMoveMetadata(date, kind, ticker, snapshot, canonicalPath);
  }
}

export async function dailyInsiderMoveMetadata(
  date: string,
  kind: DailyInsiderMoveShareKind,
  ticker: string,
  snapshot: DailyInsiderMove | null = null,
  canonicalPath: string | null = null,
): Promise<Metadata> {
  try {
    const result = await getDailyScores(date);
    const move = findInsiderMove(result.insiderMoves, kind, ticker) ?? snapshot;
    return buildInsiderMoveMetadata(result.date ?? date, kind, ticker, move, canonicalPath);
  } catch {
    return buildInsiderMoveMetadata(date, kind, ticker, snapshot, canonicalPath);
  }
}
