"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { AiAnalystTheme } from "@/lib/ai-analyst/config";
import type { PredictionDirection, PredictionStatus, PredictionTimeHorizon } from "@/lib/predictions/types";

export type PredictionMarkFields = {
  direction: PredictionDirection;
  entryPrice?: number | null;
  entryDate?: string | null;
  markPrice?: number | null;
  markPriceDate?: string | null;
  markReturnValue?: number | null;
  timeHorizon?: PredictionTimeHorizon | null;
  commentCount?: number | null;
};

export type PredictionAuthorFields = {
  userId: string;
  authorDisplayName?: string | null;
  authorNickname?: string | null;
  authorPhotoURL?: string | null;
  authorAccountType?: "HUMAN" | "AI_ANALYST" | null;
  authorAiAnalystTheme?: AiAnalystTheme | null;
  authorStats?: {
    level?: number | null;
    totalPredictions?: number | null;
  } | null;
};

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatScorePercent(score: number): string {
  return formatSignedPercent(score / 100);
}

export function formatTickerSymbol(ticker: string | null | undefined): string {
  const symbol = ticker?.trim();
  if (!symbol) {
    return "Prediction";
  }
  return symbol.replace(/^\$+/, "");
}

export function formatCashtag(ticker: string | null | undefined): string {
  const symbol = formatTickerSymbol(ticker);
  return symbol === "Prediction" ? symbol : `$${symbol}`;
}

export function formatReturnPercent(returnValue: number): string {
  return formatSignedPercent(returnValue * 100);
}

export function formatAbsoluteDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}

function wholeCalendarMonthsBetween(start: Date, end: Date): number {
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() -
    start.getMonth();
  const anniversary = new Date(start);
  anniversary.setMonth(start.getMonth() + months);
  return anniversary > end ? months - 1 : months;
}

function wholeCalendarYearsBetween(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const anniversary = new Date(start);
  anniversary.setFullYear(start.getFullYear() + years);
  return anniversary > end ? years - 1 : years;
}

export function formatRelativeDateTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return `${Math.max(1, elapsedSeconds)}s`;
  }
  if (elapsedSeconds < 60 * 60) {
    return `${Math.floor(elapsedSeconds / 60)}m`;
  }
  if (elapsedSeconds < 24 * 60 * 60) {
    return `${Math.floor(elapsedSeconds / (60 * 60))}h`;
  }
  if (elapsedSeconds < 30 * 24 * 60 * 60) {
    return `${Math.floor(elapsedSeconds / (24 * 60 * 60))}d`;
  }

  const months = wholeCalendarMonthsBetween(date, nowDate);
  if (months < 12) {
    return `${Math.max(1, months)}M`;
  }
  return `${Math.max(1, wholeCalendarYearsBetween(date, nowDate))}y`;
}

function relativeTimeRefreshDelay(value: string, now = Date.now()): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return 60 * 1000;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return 1000;
  }
  if (elapsedSeconds < 60 * 60) {
    return (60 - (elapsedSeconds % 60)) * 1000;
  }
  if (elapsedSeconds < 24 * 60 * 60) {
    return (60 * 60 - (elapsedSeconds % (60 * 60))) * 1000;
  }
  return (24 * 60 * 60 - (elapsedSeconds % (24 * 60 * 60))) * 1000;
}

export function RelativeTime({ value, prefix }: { value: string; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
    }, relativeTimeRefreshDelay(value, now));

    return () => window.clearTimeout(timeout);
  }, [value, now]);

  return (
    <time dateTime={value} title={formatAbsoluteDateTime(value)} suppressHydrationWarning>
      {prefix ? `${prefix} ` : ""}
      {formatRelativeDateTime(value, now)}
    </time>
  );
}

export function PredictionThesisText({
  text,
  fallback = "No thesis provided.",
  className = "",
}: {
  text: string;
  fallback?: string;
  className?: string;
}) {
  const content = text.trim() || fallback;

  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {content}
    </span>
  );
}

export function formatPredictionThesisTitle(value: string | null | undefined): string {
  return value?.trim() || "Untitled thesis";
}

export function formatTimeHorizon(value: PredictionTimeHorizon | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const unit = value.value === 1 ? value.unit.slice(0, -1).toLowerCase() : value.unit.toLowerCase();
  return `${value.targetDate} (${value.value} ${unit})`;
}

export function markToneClass(value: number): string {
  if (value > 0) {
    return "text-emerald-300";
  }
  if (value < 0) {
    return "text-rose-300";
  }
  return "text-slate-300";
}

function parseDateOnly(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const [dateOnly] = value.split("T");
  const timestamp = Date.parse(`${dateOnly}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function daysSinceCall(entryDate: string | null | undefined, markPriceDate: string | null | undefined): number | null {
  const entryTimestamp = parseDateOnly(entryDate);
  const markTimestamp = parseDateOnly(markPriceDate);
  if (entryTimestamp === null || markTimestamp === null) {
    return null;
  }

  return Math.max(0, Math.floor((markTimestamp - entryTimestamp) / (24 * 60 * 60 * 1000)));
}

export function formatPredictionStatus(status: PredictionStatus): string {
  switch (status) {
    case "CREATED":
    case "OPEN":
      return "Live";
    case "CLOSING":
      return "Settles at next close";
    case "SETTLED":
      return "Settled";
    case "CANCELED":
      return "Canceled";
  }
}

export function DirectionBadge({ direction }: { direction: PredictionDirection }) {
  const isUp = direction === "UP";

  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${isUp ? "text-emerald-300" : "text-rose-300"}`}>
      <span aria-hidden="true">{isUp ? "\u2191" : "\u2193"}</span>
      {direction}
    </span>
  );
}

export function PredictionReturnSummary({
  prediction,
  href,
  status,
}: {
  prediction: PredictionMarkFields;
  href?: string;
  status?: PredictionStatus;
}) {
  const markReturnValue = typeof prediction.markReturnValue === "number" ? prediction.markReturnValue : null;
  const entryPrice = typeof prediction.entryPrice === "number" ? prediction.entryPrice : null;
  const sinceCallDays = daysSinceCall(prediction.entryDate, prediction.markPriceDate);
  const isAwaitingEntry = status === "CREATED";
  const isAwaitingFirstMark = status === "OPEN" && entryPrice !== null && markReturnValue === null;
  const hasReturn = !isAwaitingEntry && markReturnValue !== null && sinceCallDays !== null;
  const statusLabel = status ? formatPredictionStatus(status).toLowerCase() : null;

  if (!hasReturn && !statusLabel && !isAwaitingFirstMark) {
    return null;
  }

  const content = (
    <>
      {hasReturn ? (
        <>
          <span className={`font-semibold ${markToneClass(markReturnValue)}`}>
            {formatReturnPercent(markReturnValue)}
          </span>
          <span className="text-slate-400"> since call ({sinceCallDays}d)</span>
        </>
      ) : null}
      {isAwaitingEntry ? <span className="text-slate-400">Awaiting entry price</span> : null}
      {isAwaitingFirstMark ? (
        <>
          <span className="text-slate-400">Entry: ${entryPrice.toFixed(2)}</span>
          <span className="text-slate-500"> &middot; </span>
          <span className="text-slate-400">awaiting first mark</span>
        </>
      ) : null}
      {(hasReturn || isAwaitingEntry) && statusLabel ? <span className="text-slate-500"> &middot; </span> : null}
      {!isAwaitingFirstMark && statusLabel ? <span className="text-slate-400">{statusLabel}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="mt-1 block w-fit text-sm hover:opacity-85">
        {content}
      </Link>
    );
  }

  return (
    <p className="mt-1 text-sm">
      {content}
    </p>
  );
}

export function PredictionAuthorSummary({ author, className = "" }: { author: PredictionAuthorFields; className?: string }) {
  const nickname = author.authorNickname?.trim();
  const displayName = author.authorDisplayName?.trim();
  const label = nickname ? `@${nickname}` : displayName || "Anonymous";
  const avatarLabel = nickname?.slice(0, 1) ?? displayName?.slice(0, 1) ?? "?";
  const level = author.authorStats?.level;
  const hasLevel = typeof level === "number";
  const isAiAnalyst = author.authorAccountType === "AI_ANALYST";

  return (
    <Link
      href={`/analysts/${author.userId}`}
      className={`mt-3 flex w-fit items-center gap-2 text-sm text-slate-300 hover:text-slate-100 ${className}`}
    >
      {author.authorPhotoURL ? (
        <Image
          src={author.authorPhotoURL}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded-full bg-cyan-500/20 text-[10px] font-semibold uppercase text-cyan-100">
          {avatarLabel}
        </span>
      )}
      <span className="font-medium text-cyan-200">{label}</span>
      {isAiAnalyst ? (
        <span className="rounded-full border border-cyan-400/35 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
          AI Analyst
        </span>
      ) : null}
      {hasLevel ? (
        <>
          <span className="text-slate-500">&middot;</span>
          <span className="font-medium text-cyan-200">Level {Math.max(1, Math.floor(level))}</span>
        </>
      ) : null}
    </Link>
  );
}

export function PredictionMarkSummary({ prediction }: { prediction: PredictionMarkFields }) {
  const entryPrice = prediction.entryPrice;
  const entryDate = prediction.entryDate;
  const markPrice = prediction.markPrice;
  const markPriceDate = prediction.markPriceDate;
  const markReturnValue = prediction.markReturnValue;
  const timeHorizon = formatTimeHorizon(prediction.timeHorizon);
  const hasEntryData =
    typeof entryPrice === "number" &&
    typeof entryDate === "string" &&
    entryDate.length > 0;
  const hasMarkData =
    typeof markPrice === "number" &&
    typeof markReturnValue === "number" &&
    typeof markPriceDate === "string" &&
    markPriceDate.length > 0;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
      {hasEntryData ? <span>Entry {entryPrice.toFixed(2)} @ {entryDate}</span> : null}
      {hasMarkData ? (
        <>
          <span>
            Mark {markPrice.toFixed(2)} @ {markPriceDate}
          </span>
          <span className={markToneClass(markReturnValue)}>
            {formatReturnPercent(markReturnValue)}
          </span>
        </>
      ) : null}
      {timeHorizon ? <span>Open until {timeHorizon}</span> : null}
      <span>{prediction.commentCount ?? 0} comments</span>
    </div>
  );
}

