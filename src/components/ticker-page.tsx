"use client";


import { CompanyPosts } from "./company-posts";
import { UiText, useUiText } from "@/components/ui-text";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatTickerSymbol, PredictionAuthorSummary, PredictionReturnSummary } from "@/components/prediction-ui";
import { useAuth } from "@/components/providers/auth-provider";
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
  viewerPosition?: Prediction | null;
  nextCursor: string | null;
  ticker: string;
};

function formatPositionPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function TickerPage({ ticker, overview }: { ticker: string; overview?: ReactNode }) {
  const ui = useUiText();
  const { loading: authLoading, getIdToken } = useAuth();
  const [payload, setPayload] = useState<TickerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const displayTicker = formatTickerSymbol(payload?.ticker ?? ticker);

  useEffect(() => {
    let cancelled = false;

    setPayload(null);
    setError(null);
    setLoadingMore(false);

    if (authLoading) {
      return;
    }

    void getIdToken()
      .then((token) => fetch(`/api/ticker/${ticker}?limit=25`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      }))
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

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, ticker]);

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
      const token = await getIdToken();
      const response = await fetch(`/api/ticker/${ticker}?${params.toString()}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });

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
      <main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm text-slate-300">
        {overview}
      <CompanyPosts ticker={ticker} />
        <p role="status" className="py-6">{error ?? <UiText text={"Loading company activity..."} />}</p>


      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      {overview}
      <CompanyPosts ticker={ticker} />
      <section className="border-b border-white/15 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300"><UiText text={"Community"} /></p>
            {overview ? <h2 className="mt-2 text-xl font-semibold text-cyan-100"><UiText text={"Investment views on "} />{displayTicker}</h2> : <h1 className="mt-2 font-[var(--font-sora)] text-4xl font-semibold text-cyan-100">{displayTicker}</h1>}
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"Investment views on "} />{displayTicker}.
            </p>
          </div>
        </div>
      </section>





      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Community position history"} /></h2>
        <p className="mb-3 mt-1 text-sm text-slate-400"><UiText text={"See who turned bullish or bearish, when their position opened, and how it has performed."} /></p>
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
                  aria-label={ui(`${prediction.direction === "UP" ? "Up" : "Down"} prediction for ${payload.ticker}`)}
                >
                  <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
                  <span>{displayTicker}</span>
                </Link>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                {prediction.direction === "UP" ? <UiText text={"Bullish · Long"} /> : <UiText text={"Bearish · Short"} />}
                {prediction.entryDate && prediction.entryPrice !== null
                  ? <UiText text={` · opened ${prediction.entryDate} at ${formatPositionPrice(prediction.entryPrice)}`} />
                  : <UiText text={` · recorded ${prediction.createdAt.slice(0, 10)} · entry pending`} />}
              </p>
              <PredictionReturnSummary prediction={prediction} href={`/predictions/${prediction.id}`} status={prediction.status} />
              <PredictionAuthorSummary author={prediction} />
            </article>
          ))}

          {payload.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300"><UiText text={"No community positions for "} />{displayTicker}<UiText text={" yet. Be the first to record your view."} /></p>
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
              {loadingMore ? <UiText text={"Loading..."} /> : <UiText text={"Load more"} />}
            </button>
          </div>
        ) : null}

        {error && payload.items.length > 0 ? (
          <p className="mt-3 text-center text-sm text-rose-200">{<UiText text={error} />}</p>
        ) : null}
      </section>
    </main>
  );
}
