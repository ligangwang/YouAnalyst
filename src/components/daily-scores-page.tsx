"use client";


import { UiText, useUiText } from "@/components/ui-text";
import { useLocale } from "@/components/providers/locale-provider";
import { companyName } from "@/lib/knowledge-graph/model";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCashtag, formatTickerSymbol } from "@/components/prediction-ui";
import { useAuth } from "@/components/providers/auth-provider";
import {
  dailyCanonicalPath,
  dailyShareVersion,
} from "@/lib/daily-scores/public-share";
import { xPostIntentUrl, xTrackedShareUrl } from "@/lib/x-share";

type DailyCallHighlight = {
  predictionId: string;
  userId: string;
  displayName: string | null;
  nickname: string | null;
  ticker: string | null;
  company?: { id: string; name: string; names: Partial<Record<"en" | "zh-CN", string>> };
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

type DailyScoresResponse = {
  date: string | null;
  callOfTheDay: DailyCallHighlight | null;
  topCalls: DailyCallHighlight[];

};

export type DailyScoresSection = "calls";

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

function dailyShareUrl(date: string | null): string {
  const path = dailyCanonicalPath(date);
  return xTrackedShareUrl({
    campaign: "daily_share",
    share: dailyShareVersion(date),
    url: path,
  });
}

function dailySectionPath(date: string | null): string {
  return dailyCanonicalPath(date);
}

function shareText(payload: DailyScoresResponse): string {
  const call = payload.callOfTheDay;
  if (!call) {
    return "Daily stock-call results are live on YouAnalyst.";
  }

  return `Daily stock-call results are live on YouAnalyst. Top call: ${formatCashtag(call.ticker)}.`;
}

function xShareUrl(payload: DailyScoresResponse): string {
  return xPostIntentUrl({
    text: shareText(payload),
    url: dailyShareUrl(payload.date),
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

export function DailyScoresPage({
  initialDate = null,
  section = "calls",
}: {
  initialDate?: string | null;
  section?: DailyScoresSection;
}) {
  const ui = useUiText();
  const { locale } = useLocale();
  const callCompanyName = (call: DailyCallHighlight) => call.company ? companyName(call.company, locale) : formatTickerSymbol(call.ticker);
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
    return <main className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-slate-300"><UiText text={"Loading daily highlights..."} /></main>;
  }

  const topCalls = payload?.topCalls ?? [];
  const callOfTheDay = payload?.callOfTheDay ?? null;
  const showCalls = section === "calls";
  const heroCopy = {
    calls: {
      title: "Best Calls Today",
      description: "Top-performing predictions based on the latest end-of-day results.",
    },
  }[section];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <section className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-cyan-300">{dateLabel(payload?.date ?? null)}</p>
            <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">{<UiText text={heroCopy.title} />}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              {<UiText text={heroCopy.description} />}
            </p>
          </div>
          {payload && showCalls ? (
            <div className="flex flex-wrap gap-2">
              {canShareOnX ? (
                <a
                  href={xShareUrl(payload)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                ><UiText text={"Share on X"} /></a>
              ) : null}
              <button
                type="button"
                onClick={() => void copyDailyLink()}
                className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
              ><UiText text={"Copy link"} /></button>
              {copied ? <span className="self-center text-xs text-emerald-300"><UiText text={"Copied"} /></span> : null}
            </div>
          ) : null}
        </div>
      </section>

      <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label={ui("Daily sections")}>
        {([
          ["calls", "Top Calls"],
        ] as const).map(([nextSection, label]) => (
          <Link
            key={nextSection}
            href={dailySectionPath(payload?.date ?? initialDate)}
            className={`rounded-full border px-3 py-1.5 font-semibold ${
              section === nextSection
                ? "border-cyan-300 bg-cyan-500/15 text-cyan-100"
                : "border-white/10 text-slate-300 hover:border-cyan-300/60 hover:text-cyan-100"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {error ? <p className="mt-4 text-sm text-rose-300">{<UiText text={error} />}</p> : null}

      {showCalls && payload && topCalls.length === 0 ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-5">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"No daily highlights yet."} /></h2>
          <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Check back after more predictions settle and update."} /></p>
          <Link
            href="/predictions/new"
            className="mt-4 inline-flex rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          ><UiText text={"Make the first call"} /></Link>
        </section>
      ) : null}

      {showCalls && callOfTheDay ? (
        <Link
          href={predictionPath(callOfTheDay.predictionId)}
          className="mt-4 block rounded-xl border border-cyan-400/35 bg-slate-900/80 p-5 hover:border-cyan-300/70"
        >
          <p className="text-sm font-semibold text-cyan-200"><UiText text={"🏆 Call of the Day"} /></p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="break-words font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">
                <span aria-hidden="true" className="mr-2">
                  {directionArrow(callOfTheDay.direction)}
                </span>
                {callCompanyName(callOfTheDay)}
              </p>
              {callOfTheDay.company && callCompanyName(callOfTheDay) !== formatTickerSymbol(callOfTheDay.ticker) ? <p className="mt-1 text-sm text-slate-400">{formatTickerSymbol(callOfTheDay.ticker)}</p> : null}
              <p className="mt-2 text-sm text-slate-300"><UiText text={"by "} />{userName(callOfTheDay)}</p>
              <p className="mt-3 text-sm text-slate-400">{callDescription(callOfTheDay)}</p>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className={`text-4xl font-semibold ${returnTone(callOfTheDay.dailyReturnChange)}`}>
                {dailyReturnText(callOfTheDay.dailyReturnChange)}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400"><UiText text={"today"} /></p>
              <p className="mt-1 text-xs text-slate-400">{scoreText(callOfTheDay.dailyScoreChange)}<UiText text={" score today"} /></p>
              {callOfTheDay.dailyReturnChange !== null && returnText(callOfTheDay.returnSinceEntry) && callOfTheDay.returnSinceEntry !== callOfTheDay.dailyReturnChange ? (
                <p className="mt-1 text-xs text-slate-500">{returnText(callOfTheDay.returnSinceEntry)}<UiText text={" since entry"} /></p>
              ) : null}
            </div>
          </div>
        </Link>
      ) : null}

      {showCalls && topCalls.length > 0 ? (
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Top Calls Today"} /></h2>
            <p className="mt-1 text-sm text-slate-300"><UiText text={"The strongest prediction moves from the latest end-of-day update."} /></p>
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
                    {callCompanyName(call)}
                  </span>
                  {call.company && callCompanyName(call) !== formatTickerSymbol(call.ticker) ? <span className="text-slate-400"> · {formatTickerSymbol(call.ticker)}</span> : null}
                  <span className="text-slate-500"> / </span>
                  <span>{userName(call)}</span>
                </Link>
                <span className="text-right">
                  <span className={`block text-sm font-semibold ${returnTone(call.dailyReturnChange)}`}>
                    {dailyReturnText(call.dailyReturnChange)}
                  </span>
                  <span className="block text-[11px] text-slate-500"><UiText text={"today &middot; "} />{scoreText(call.dailyScoreChange)}<UiText text={" score today"} /></span>
                  {call.dailyReturnChange === null ? (
                    <Link
                      href={missingDailyReturnReportPath(call, payload?.date ?? null)}
                      className="mt-1 inline-block text-[11px] font-semibold text-rose-300 hover:text-rose-200"
                    ><UiText text={"Report issue"} /></Link>
                  ) : null}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-xl border border-white/10 bg-slate-900/55 p-5">
        <p className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Think you can beat today&apos;s top call?"} /></p>
        <p className="mt-1 text-sm text-slate-300"><UiText text={"Make your prediction on YouAnalyst."} /></p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/predictions/new"
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          ><UiText text={"Make a prediction"} /></Link>
          <Link
            href="/predictions"
            className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15"
          ><UiText text={"View feed"} /></Link>
        </div>
      </section>
    </main>
  );
}
