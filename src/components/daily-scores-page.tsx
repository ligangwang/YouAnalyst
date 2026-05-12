"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCashtag, formatTickerSymbol } from "@/components/prediction-ui";
import { useAuth } from "@/components/providers/auth-provider";
import { insiderMoveSnapshotSegment } from "@/lib/daily-scores/insider-share-snapshot";
import { institutionalMoveSnapshotSegment } from "@/lib/daily-scores/institutional-share-snapshot";
import {
  dailyCanonicalPath,
  dailyInsiderMoveSharePath,
  dailyInsiderMoveShareVersion,
  dailyInstitutionalMoveSharePath,
  dailyInstitutionalMoveShareVersion,
  dailyShareVersion,
} from "@/lib/daily-scores/public-share";
import { xPostIntentUrl } from "@/lib/x-share";

type DailyCallHighlight = {
  predictionId: string;
  userId: string;
  displayName: string | null;
  nickname: string | null;
  ticker: string | null;
  direction: "UP" | "DOWN" | null;
  dailyScoreChange: number;
  dailyReturnChange: number | null;
  totalScore: number;
  returnSinceEntry: number | null;
  status: "LIVE" | "SETTLED";
  createdAt: string;
  thesisTitle: string | null;
  thesis: string | null;
};

type DailyInstitutionalMove = {
  ticker: string;
  nameOfIssuer: string;
  filingDate?: string | null;
  reportDate: string;
  managerCount: number;
  valueChangeUsd: number;
  shareChange: number;
  newManagers: number;
  increasedManagers: number;
  reducedManagers: number;
  soldOutManagers: number;
};

type DailyInsiderMove = {
  ticker: string;
  issuerName: string;
  filingDate: string;
  transactionCode: "P" | "S";
  totalValueUsd: number;
  totalShares: number;
  insiderCount: number;
  transactionCount: number;
  latestTransactionDate: string;
};

type DailyScoresResponse = {
  date: string | null;
  callOfTheDay: DailyCallHighlight | null;
  topCalls: DailyCallHighlight[];
  institutionalMoves?: {
    increases: DailyInstitutionalMove[];
    decreases: DailyInstitutionalMove[];
  };
  insiderMoves?: {
    purchases: DailyInsiderMove[];
    sales: DailyInsiderMove[];
  };
};

function scoreText(score: number): string {
  const sign = score > 0 ? "+" : "";
  return `${sign}${Math.round(score)}`;
}

function returnTone(returnValue: number | null): string {
  if (returnValue === null) {
    return "text-slate-300";
  }
  if (returnValue > 0) {
    return "text-emerald-300";
  }
  if (returnValue < 0) {
    return "text-rose-300";
  }
  return "text-slate-300";
}

function dateLabel(value: string | null): string {
  if (!value) {
    return "LATEST DAY";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

function compactDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function userName(user: { displayName: string | null; nickname: string | null }): string {
  return user.nickname ? `@${user.nickname}` : user.displayName ?? "Anonymous";
}

function directionArrow(direction: "UP" | "DOWN" | null): string {
  if (direction === "UP") {
    return "\u2191";
  }
  if (direction === "DOWN") {
    return "\u2193";
  }
  return "";
}

function absoluteUrl(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }
  return `${window.location.origin}${path}`;
}

function predictionPath(predictionId: string): string {
  return `/predictions/${predictionId}`;
}

function missingDailyReturnReportPath(call: DailyCallHighlight, date: string | null): string {
  const subject = `Missing Daily Return: ${call.predictionId}`;
  const message = [
    "Missing daily return data on Top Calls Today.",
    "",
    `Prediction ID: ${call.predictionId}`,
    `Prediction URL: ${predictionPath(call.predictionId)}`,
    `Prediction: ${directionArrow(call.direction)} ${formatTickerSymbol(call.ticker)}`,
    `Thesis title: ${call.thesisTitle ?? "Unknown"}`,
    `Thesis: ${call.thesis ?? "Unknown"}`,
    `User: ${userName(call)} (${call.userId})`,
    `Daily page date: ${date ?? "latest"}`,
    `Daily score change: ${scoreText(call.dailyScoreChange)}`,
    `Status: ${call.status}`,
    `Created at: ${call.createdAt || "Unknown"}`,
    `Return since entry: ${returnText(call.returnSinceEntry) ?? "Unknown"}`,
    "",
    "Expected: ticker daily return should be present for this daily mark.",
  ].join("\n");
  const params = new URLSearchParams({
    category: "BUG_REPORT",
    subject,
    message,
  });

  return `/feedback?${params.toString()}`;
}

function dailySharePath(date: string | null): string {
  const path = dailyCanonicalPath(date);
  const url = new URL(path, typeof window === "undefined" ? "https://youanalyst.com" : window.location.origin);
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "daily_share");
  url.searchParams.set("share", dailyShareVersion(date));
  return `${url.pathname}${url.search}`;
}

function shareText(payload: DailyScoresResponse): string {
  const call = payload.callOfTheDay;
  if (!call) {
    return "Daily stock-call results are live on YouAnalyst.";
  }

  return `Daily stock-call results are live on YouAnalyst. Top call: ${formatCashtag(call.ticker)}.`;
}

function xShareUrl(payload: DailyScoresResponse): string {
  const url = absoluteUrl(dailySharePath(payload.date));
  return xPostIntentUrl({
    text: shareText(payload),
    url,
  });
}

function moveSharePath(date: string | null, move: DailyInstitutionalMove, kind: "increase" | "decrease"): string {
  const shareDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const path = dailyInstitutionalMoveSharePath(shareDate, kind, move.ticker);
  const url = new URL(path, typeof window === "undefined" ? "https://youanalyst.com" : window.location.origin);
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", `institutional_${kind}_share`);
  url.searchParams.set("share", dailyInstitutionalMoveShareVersion(shareDate, kind, move.ticker));
  url.pathname = `${url.pathname}/${institutionalMoveSnapshotSegment(move)}`;
  return `${url.pathname}${url.search}`;
}

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function moveShareText(move: DailyInstitutionalMove, kind: "increase" | "decrease"): string {
  const direction = kind === "increase" ? "increased" : "reduced";
  const amount = kind === "increase" ? formatSignedCurrency(move.valueChangeUsd) : formatCurrency(Math.abs(move.valueChangeUsd));
  return `Latest 13F reports show ${formatCashtag(move.ticker)} ${direction} by ${amount} across ${move.managerCount} manager${move.managerCount === 1 ? "" : "s"} as of ${move.reportDate}.`;
}

function moveShareUrl(move: DailyInstitutionalMove, date: string | null, kind: "increase" | "decrease"): string {
  return xPostIntentUrl({
    text: moveShareText(move, kind),
    url: absoluteUrl(moveSharePath(date, move, kind)),
  });
}

function insiderMoveSharePath(date: string | null, move: DailyInsiderMove, kind: "purchase" | "sale"): string {
  const shareDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const path = dailyInsiderMoveSharePath(shareDate, kind, move.ticker);
  const url = new URL(path, typeof window === "undefined" ? "https://youanalyst.com" : window.location.origin);
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", `insider_${kind}_share`);
  url.searchParams.set("share", dailyInsiderMoveShareVersion(shareDate, kind, move.ticker));
  url.pathname = `${url.pathname}/${insiderMoveSnapshotSegment(move)}`;
  return `${url.pathname}${url.search}`;
}

function insiderMoveShareText(move: DailyInsiderMove, kind: "purchase" | "sale"): string {
  const noun = kind === "purchase" ? "purchases" : "sales";
  return `Latest Form 4 reports show ${formatCashtag(move.ticker)} insider ${noun} totaling ${formatCurrency(move.totalValueUsd)} across ${move.insiderCount} insider${move.insiderCount === 1 ? "" : "s"}, filed ${move.filingDate}.`;
}

function insiderMoveShareUrl(move: DailyInsiderMove, date: string | null, kind: "purchase" | "sale"): string {
  return xPostIntentUrl({
    text: insiderMoveShareText(move, kind),
    url: absoluteUrl(insiderMoveSharePath(date, move, kind)),
  });
}

function callDescription(call: DailyCallHighlight): string {
  return call.dailyScoreChange > 0
    ? "Best-performing call in today's end-of-day update."
    : "Largest call move in today's end-of-day update.";
}

function returnText(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function dailyReturnText(value: number | null): string {
  if (value === null) {
    return "Missing daily data";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function InstitutionalMoveCard({
  kind,
  move,
}: {
  kind: "increase" | "decrease";
  move: DailyInstitutionalMove;
}) {
  const isIncrease = kind === "increase";
  const statusText = isIncrease
    ? `${move.newManagers} new / ${move.increasedManagers} increased`
    : `${move.reducedManagers} reduced / ${move.soldOutManagers} sold out`;

  return (
    <article className="rounded-lg border border-white/10 p-3">
      <div>
        <Link href={`/ticker/${encodeURIComponent(move.ticker)}`} className="min-w-0 hover:text-cyan-100">
          <p className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">{formatTickerSymbol(move.ticker)}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{move.nameOfIssuer}</p>
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Value change</p>
          <p className={`mt-1 font-semibold tabular-nums ${isIncrease ? "text-emerald-300" : "text-rose-300"}`}>
            {formatSignedCurrency(move.valueChangeUsd)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Shares</p>
          <p className="mt-1 font-semibold tabular-nums text-slate-100">{formatNumber(move.shareChange)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Managers</p>
          <p className="mt-1 font-semibold tabular-nums text-slate-100">{formatNumber(move.managerCount)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {statusText}
        {move.filingDate ? ` \u00b7 filed ${compactDateLabel(move.filingDate)}` : ""}
        {" \u00b7 "}report {compactDateLabel(move.reportDate)}
      </p>
    </article>
  );
}

function InsiderMoveCard({
  kind,
  move,
}: {
  kind: "purchase" | "sale";
  move: DailyInsiderMove;
}) {
  const isPurchase = kind === "purchase";

  return (
    <article className="rounded-lg border border-white/10 p-3">
      <div>
        <Link href={`/ticker/${encodeURIComponent(move.ticker)}`} className="min-w-0 hover:text-cyan-100">
          <p className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">{formatTickerSymbol(move.ticker)}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{move.issuerName}</p>
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Value</p>
          <p className={`mt-1 font-semibold tabular-nums ${isPurchase ? "text-emerald-300" : "text-rose-300"}`}>
            {formatCurrency(move.totalValueUsd)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Shares</p>
          <p className="mt-1 font-semibold tabular-nums text-slate-100">{formatNumber(move.totalShares)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Insiders</p>
          <p className="mt-1 font-semibold tabular-nums text-slate-100">{formatNumber(move.insiderCount)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {formatNumber(move.transactionCount)} transaction{move.transactionCount === 1 ? "" : "s"} &middot; latest transaction {compactDateLabel(move.latestTransactionDate)} &middot; filed {compactDateLabel(move.filingDate)}
      </p>
    </article>
  );
}

export function DailyScoresPage({ initialDate = null }: { initialDate?: string | null }) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [payload, setPayload] = useState<DailyScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [adminStatus, setAdminStatus] = useState<{ userId: string; isAdmin: boolean } | null>(null);
  const canShareOnX = Boolean(!authLoading && user && adminStatus?.userId === user.uid && adminStatus.isAdmin);

  const apiPath = useMemo(() => {
    if (typeof window === "undefined") {
      return "/api/daily-scores";
    }

    const date = initialDate ?? new URLSearchParams(window.location.search).get("date");
    return date ? `/api/daily-scores?date=${encodeURIComponent(date)}` : "/api/daily-scores";
  }, [initialDate]);

  useEffect(() => {
    let cancelled = false;

    void fetch(apiPath)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load daily highlights.");
        }

        const nextPayload = (await response.json()) as DailyScoresResponse;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load daily highlights.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    let cancelled = false;
    const userId = user.uid;

    async function loadAdminStatus() {
      try {
        const token = await getIdToken(true);

        if (!token) {
          if (!cancelled) {
            setAdminStatus({ userId, isAdmin: false });
          }
          return;
        }

        const response = await fetch("/api/admin/me", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const body = (await response.json().catch(() => ({}))) as { isAdmin?: boolean };

        if (!cancelled) {
          setAdminStatus({ userId, isAdmin: response.ok && body.isAdmin === true });
        }
      } catch {
        if (!cancelled) {
          setAdminStatus({ userId, isAdmin: false });
        }
      }
    }

    void loadAdminStatus();

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, user]);

  async function copyDailyLink() {
    if (!payload) {
      return;
    }

    try {
      await navigator.clipboard.writeText(absoluteUrl(dailyCanonicalPath(payload.date)));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (loading) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-slate-300">Loading daily highlights...</main>;
  }

  const topCalls = payload?.topCalls ?? [];
  const callOfTheDay = payload?.callOfTheDay ?? null;
  const institutionalIncreases = payload?.institutionalMoves?.increases ?? [];
  const institutionalDecreases = payload?.institutionalMoves?.decreases ?? [];
  const topInstitutionalIncrease = institutionalIncreases[0] ?? null;
  const topInstitutionalDecrease = institutionalDecreases[0] ?? null;
  const insiderPurchases = payload?.insiderMoves?.purchases ?? [];
  const insiderSales = payload?.insiderMoves?.sales ?? [];
  const topInsiderPurchase = insiderPurchases[0] ?? null;
  const topInsiderSale = insiderSales[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <section className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-cyan-300">{dateLabel(payload?.date ?? null)}</p>
            <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">Best Calls Today</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Top-performing predictions based on the latest end-of-day results.
            </p>
          </div>
          {payload ? (
            <div className="flex flex-wrap gap-2">
              {canShareOnX ? (
                <a
                  href={xShareUrl(payload)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                >
                  Share on X
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void copyDailyLink()}
                className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
              >
                Copy link
              </button>
              {copied ? <span className="self-center text-xs text-emerald-300">Copied</span> : null}
            </div>
          ) : null}
        </div>
      </section>

      {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}

      {payload && topCalls.length === 0 ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-5">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">No daily highlights yet.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Check back after more predictions settle and update.
          </p>
          <Link
            href="/predictions/new"
            className="mt-4 inline-flex rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Make the first call
          </Link>
        </section>
      ) : null}

      {callOfTheDay ? (
        <Link
          href={predictionPath(callOfTheDay.predictionId)}
          className="mt-4 block rounded-xl border border-cyan-400/35 bg-slate-900/80 p-5 hover:border-cyan-300/70"
        >
          <p className="text-sm font-semibold text-cyan-200">🏆 Call of the Day</p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-[var(--font-sora)] text-4xl font-semibold text-cyan-100">
                <span aria-hidden="true" className="mr-2">
                  {directionArrow(callOfTheDay.direction)}
                </span>
                {formatTickerSymbol(callOfTheDay.ticker)}
              </p>
              <p className="mt-2 text-sm text-slate-300">by {userName(callOfTheDay)}</p>
              <p className="mt-3 text-sm text-slate-400">{callDescription(callOfTheDay)}</p>
            </div>
            <div className="sm:text-right">
              <p className={`text-4xl font-semibold ${returnTone(callOfTheDay.dailyReturnChange)}`}>
                {dailyReturnText(callOfTheDay.dailyReturnChange)}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">today</p>
              <p className="mt-1 text-xs text-slate-400">{scoreText(callOfTheDay.dailyScoreChange)} score today</p>
              {callOfTheDay.dailyReturnChange !== null && returnText(callOfTheDay.returnSinceEntry) && callOfTheDay.returnSinceEntry !== callOfTheDay.dailyReturnChange ? (
                <p className="mt-1 text-xs text-slate-500">{returnText(callOfTheDay.returnSinceEntry)} since entry</p>
              ) : null}
            </div>
          </div>
        </Link>
      ) : null}

      {topCalls.length > 0 ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Top Calls Today</h2>
            <p className="mt-1 text-sm text-slate-300">
              The strongest prediction moves from the latest end-of-day update.
            </p>
          </div>
          <div className="mt-4 grid gap-2">
            {topCalls.map((call, index) => (
              <article
                key={call.predictionId}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-white/10 p-3"
              >
                <span className="text-sm font-semibold text-cyan-200">#{index + 1}</span>
                <Link
                  href={predictionPath(call.predictionId)}
                  className="min-w-0 text-sm text-slate-100 hover:text-cyan-100"
                >
                  <span className="font-semibold text-cyan-200">
                    {directionArrow(call.direction) ? (
                      <span aria-hidden="true" className="mr-1">
                        {directionArrow(call.direction)}
                      </span>
                    ) : null}
                    {formatTickerSymbol(call.ticker)}
                  </span>
                  <span className="text-slate-500"> / </span>
                  <span>{userName(call)}</span>
                </Link>
                <span className="text-right">
                  <span className={`block text-sm font-semibold ${returnTone(call.dailyReturnChange)}`}>
                    {dailyReturnText(call.dailyReturnChange)}
                  </span>
                  <span className="block text-[11px] text-slate-500">today &middot; {scoreText(call.dailyScoreChange)} score today</span>
                  {call.dailyReturnChange === null ? (
                    <Link
                      href={missingDailyReturnReportPath(call, payload?.date ?? null)}
                      className="mt-1 inline-block text-[11px] font-semibold text-rose-300 hover:text-rose-200"
                    >
                      Report issue
                    </Link>
                  ) : null}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {insiderPurchases.length > 0 || insiderSales.length > 0 ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Insider Activity</h2>
              <p className="mt-1 text-sm text-slate-300">
                Latest Form 4 open-market purchases and sales ranked by reported dollar value.
              </p>
            </div>
            {canShareOnX ? (
              <div className="flex flex-wrap gap-2">
                {topInsiderPurchase ? (
                  <a
                    href={insiderMoveShareUrl(topInsiderPurchase, payload?.date ?? null, "purchase")}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-emerald-400/35 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15"
                  >
                    Share purchase to X
                  </a>
                ) : null}
                {topInsiderSale ? (
                  <a
                    href={insiderMoveShareUrl(topInsiderSale, payload?.date ?? null, "sale")}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-rose-400/35 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/15"
                  >
                    Share sale to X
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Largest purchases</h3>
              <div className="mt-3 grid gap-2">
                {insiderPurchases.length > 0 ? insiderPurchases.map((move) => (
                  <InsiderMoveCard key={`purchase-${move.ticker}-${move.filingDate}`} kind="purchase" move={move} />
                )) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-sm text-slate-400">No insider purchases are available yet.</p>}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-rose-300">Largest sales</h3>
              <div className="mt-3 grid gap-2">
                {insiderSales.length > 0 ? insiderSales.map((move) => (
                  <InsiderMoveCard key={`sale-${move.ticker}-${move.filingDate}`} kind="sale" move={move} />
                )) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-sm text-slate-400">No insider sales are available yet.</p>}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {institutionalIncreases.length > 0 || institutionalDecreases.length > 0 ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Institutional Moves</h2>
              <p className="mt-1 text-sm text-slate-300">
                Latest reported 13F position changes ranked by net reported dollar change.
              </p>
            </div>
            {canShareOnX ? (
              <div className="flex flex-wrap gap-2">
                {topInstitutionalIncrease ? (
                  <a
                    href={moveShareUrl(topInstitutionalIncrease, payload?.date ?? null, "increase")}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-emerald-400/35 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15"
                  >
                    Share increase to X
                  </a>
                ) : null}
                {topInstitutionalDecrease ? (
                  <a
                    href={moveShareUrl(topInstitutionalDecrease, payload?.date ?? null, "decrease")}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-rose-400/35 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/15"
                  >
                    Share decrease to X
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Largest increases from latest filings</h3>
              <div className="mt-3 grid gap-2">
                {institutionalIncreases.length > 0 ? institutionalIncreases.map((move) => (
                  <InstitutionalMoveCard key={`increase-${move.ticker}`} kind="increase" move={move} />
                )) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-sm text-slate-400">No increased 13F positions are available yet.</p>}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-rose-300">Largest decreases from latest filings</h3>
              <div className="mt-3 grid gap-2">
                {institutionalDecreases.length > 0 ? institutionalDecreases.map((move) => (
                  <InstitutionalMoveCard key={`decrease-${move.ticker}`} kind="decrease" move={move} />
                )) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-sm text-slate-400">No reduced 13F positions are available yet.</p>}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-xl border border-white/10 bg-slate-900/55 p-5">
        <p className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
          Think you can beat today&apos;s top call?
        </p>
        <p className="mt-1 text-sm text-slate-300">Make your prediction on YouAnalyst.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/predictions/new"
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Make a prediction
          </Link>
          <Link
            href="/predictions"
            className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15"
          >
            View feed
          </Link>
        </div>
      </section>
    </main>
  );
}
