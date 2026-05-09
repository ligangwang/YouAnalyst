"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatTickerSymbol, PredictionAuthorSummary, PredictionReturnSummary } from "@/components/prediction-ui";
import { type PredictionStatus } from "@/lib/predictions/types";

type Prediction = {
  id: string;
  userId: string;
  authorDisplayName: string | null;
  authorNickname: string | null;
  authorPhotoURL: string | null;
  authorStats?: {
    level?: number | null;
    totalPredictions?: number | null;
  } | null;
  direction: "UP" | "DOWN";
  entryPrice: number | null;
  entryDate: string | null;
  thesisTitle: string;
  thesis: string;
  status: PredictionStatus;
  createdAt: string;
  markPrice?: number | null;
  markPriceDate?: string | null;
  markReturnValue?: number | null;
  commentCount: number;
  result: {
    score: number;
  } | null;
};

type TickerResponse = {
  items: Prediction[];
  nextCursor: string | null;
  ticker: string;
};

type InstitutionalTickerPosition = {
  managerCik: string;
  managerName: string;
  ticker: string;
  nameOfIssuer: string;
  quarter: string;
  reportDate: string;
  filingDate: string;
  accessionNumber: string;
  shares: number;
  valueUsd: number;
  positionCount: number;
  changeStatus: "NEW" | "INCREASED" | "REDUCED" | "SOLD_OUT" | "UNCHANGED" | null;
  shareChange: number | null;
  valueChangeUsd: number | null;
  percentChange: number | null;
  updatedAt: string;
};

type InstitutionalTickerSummary = {
  ticker: string;
  totalManagers: number;
  totalValueUsd: number;
  totalShares: number;
  latestReportDate: string | null;
  positions: InstitutionalTickerPosition[];
};

type ErrorResponse = {
  error?: unknown;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "new";
  }

  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(value)}`;
}

function changeTone(status: InstitutionalTickerPosition["changeStatus"]): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

function readErrorMessage(payload: ErrorResponse, fallback: string): string {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
}

function InstitutionalHoldingsSection({
  displayTicker,
  summary,
  error,
}: {
  displayTicker: string;
  summary: InstitutionalTickerSummary | null;
  error: string | null;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Institutional holdings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Latest 13F positions and changes reported by tracked institutions for {displayTicker}.
          </p>
        </div>
        {summary?.latestReportDate ? (
          <p className="text-sm font-semibold text-slate-300">Latest report {summary.latestReportDate}</p>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Managers</p>
            <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{summary.totalManagers}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reported value</p>
            <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{formatCurrency(summary.totalValueUsd)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reported shares</p>
            <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{formatNumber(summary.totalShares)}</p>
          </div>
        </div>
      ) : null}

      {summary ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3 pr-3">Institution</th>
                <th className="py-3 pr-3 text-right">Value</th>
                <th className="py-3 pr-3 text-right">Shares</th>
                <th className="py-3 pr-3">Change</th>
                <th className="py-3 pr-3 text-right">Value change</th>
                <th className="py-3">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {summary.positions.map((position) => (
                <tr key={`${position.managerCik}_${position.accessionNumber}`} className="text-slate-200">
                  <td className="py-3 pr-3">
                    <Link href={`/institutions/${position.managerCik}`} className="font-semibold text-cyan-100 hover:text-cyan-300">
                      {position.managerName}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">CIK {position.managerCik}</p>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(position.valueUsd)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatNumber(position.shares)}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(position.changeStatus)}`}>
                      {position.changeStatus ?? "CURRENT"} {position.changeStatus ? formatPercent(position.percentChange) : ""}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    {position.valueChangeUsd === null ? "Unknown" : formatCurrency(position.valueChangeUsd)}
                  </td>
                  <td className="py-3 text-slate-400">
                    {position.quarter}
                    <p className="text-xs text-slate-500">{position.reportDate}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {summary && summary.positions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No tracked institutional 13F positions are available for {displayTicker} yet.
        </p>
      ) : null}

      {!summary && !error ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          Loading institutional holdings...
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-slate-500">
        13F filings are delayed, may omit some positions, and are not investment advice. Review original filings and do your own due diligence.
      </p>
    </section>
  );
}

export function TickerPage({ ticker }: { ticker: string }) {
  const [payload, setPayload] = useState<TickerResponse | null>(null);
  const [holdings, setHoldings] = useState<InstitutionalTickerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const displayTicker = formatTickerSymbol(payload?.ticker ?? ticker);

  useEffect(() => {
    let cancelled = false;

    setPayload(null);
    setHoldings(null);
    setError(null);
    setHoldingsError(null);
    setLoadingMore(false);

    void fetch(`/api/ticker/${ticker}?limit=25`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load ticker predictions.");
        }

        return (await response.json()) as TickerResponse;
      })
      .then((nextPayload) => {
        if (!cancelled) {
          setPayload(nextPayload);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load ticker.");
        }
      });

    void fetch(`/api/institutional-holdings/${encodeURIComponent(ticker)}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ErrorResponse;
          throw new Error(readErrorMessage(body, "Unable to load institutional holdings."));
        }

        return (await response.json()) as InstitutionalTickerSummary;
      })
      .then((nextHoldings) => {
        if (!cancelled) {
          setHoldings(nextHoldings);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setHoldingsError(nextError instanceof Error ? nextError.message : "Unable to load institutional holdings.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  async function loadMorePredictions() {
    if (!payload?.nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: "25",
        cursorCreatedAt: payload.nextCursor,
      });
      const response = await fetch(`/api/ticker/${ticker}?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Unable to load more predictions.");
      }

      const nextPayload = (await response.json()) as TickerResponse;
      setPayload((current) => current
        ? {
            ...nextPayload,
            items: [...current.items, ...nextPayload.items],
          }
        : nextPayload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load more predictions.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (!payload) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-8 text-sm text-slate-300">
        {error ?? "Loading ticker..."}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Company</p>
            <h1 className="mt-2 font-[var(--font-sora)] text-4xl font-semibold text-cyan-100">{displayTicker}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Public calls, watchlists, and institutional 13F context for {displayTicker}.
            </p>
          </div>
          <Link
            href={`/predictions/new?ticker=${encodeURIComponent(payload.ticker)}`}
            className="w-full rounded-lg bg-cyan-500 px-4 py-2 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-400 sm:w-auto"
          >
            Make your call
          </Link>
        </div>
      </section>

      <InstitutionalHoldingsSection
        displayTicker={displayTicker}
        summary={holdings}
        error={holdingsError}
      />

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <h2 className="mb-3 font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Predictions</h2>
        <div className="grid gap-2">
          {payload.items.map((prediction) => (
            <article
              key={prediction.id}
              className="rounded-xl border border-white/10 p-4 hover:border-cyan-300/60"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  href={`/ticker/${payload.ticker}`}
                  className="flex w-fit items-center gap-1 text-base font-semibold text-cyan-200 hover:text-cyan-100"
                  aria-label={`${prediction.direction === "UP" ? "Up" : "Down"} prediction for ${payload.ticker}`}
                >
                  <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
                  <span>{displayTicker}</span>
                </Link>
              </div>
              <PredictionReturnSummary prediction={prediction} href={`/predictions/${prediction.id}`} status={prediction.status} />
              <PredictionAuthorSummary author={prediction} />
            </article>
          ))}

          {payload.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
              No predictions for {displayTicker} yet.
            </p>
          ) : null}
        </div>

        {payload.nextCursor ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={loadMorePredictions}
              disabled={loadingMore}
              className="rounded-lg border border-cyan-400/40 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}

        {error && payload.items.length > 0 ? (
          <p className="mt-3 text-center text-sm text-rose-200">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
