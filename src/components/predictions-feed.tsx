"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  ticker: string;
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
    returnValue: number;
  } | null;
};

type FeedResponse = {
  items: Prediction[];
  nextCursor: string | null;
  viewerAccess?: "preview" | "full";
  previewLimit?: number | null;
};

const FEED_QUERY = "limit=20&sort=createdAt";

export function PredictionsFeed() {
  const { loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<Prediction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [viewerAccess, setViewerAccess] = useState<"preview" | "full">("full");
  const [previewLimit, setPreviewLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadFeed() {
      const token = await getIdToken();
      const response = await fetch(`/api/predictions?${FEED_QUERY}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });

      if (!response.ok) {
        throw new Error("Unable to load predictions.");
      }

      return (await response.json()) as FeedResponse;
    }

    void loadFeed()
      .then(async (response) => {
        if (!cancelled) {
          setItems(response.items);
          setNextCursor(response.nextCursor);
          setViewerAccess(response.viewerAccess === "preview" ? "preview" : "full");
          setPreviewLimit(response.previewLimit ?? null);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load feed.");
          setItems([]);
          setNextCursor(null);
          setViewerAccess("full");
          setPreviewLimit(null);
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
  }, [authLoading, getIdToken, attempt]);

  async function loadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }

    const params = new URLSearchParams(FEED_QUERY);
    params.set("cursorCreatedAt", nextCursor);

    setLoadingMore(true);
    setMoreError(null);

    try {
      const token = await getIdToken();
      const response = await fetch(`/api/predictions?${params.toString()}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        throw new Error("Could not load more calls. Please retry.");
      }

      const payload = (await response.json()) as FeedResponse;
      setItems((prev) => [...prev, ...payload.items]);
      setNextCursor(payload.nextCursor);
    } catch {
      setMoreError("Could not load more calls. Your loaded calls are still available; please retry.");
    } finally {
      setLoadingMore(false);
    }
  }

  const isPreview = viewerAccess === "preview";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-4 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <div className="mb-4">
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">Latest Calls</h1>
          <p className="mt-1 text-sm text-slate-300">Create watchlists, publish stock calls, and let performance speak for itself.</p>
        </div>

        {loading || authLoading ? <p className="text-sm text-slate-300">Loading feed...</p> : null}
        {error ? <div role="alert" className="text-sm text-rose-300"><p>{error}</p><button type="button" className="mt-2 underline" onClick={() => setAttempt(value => value + 1)}>Retry loading calls</button></div> : null}

        <div className="grid gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-slate-950/55 p-4 transition"
            >
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  href={`/ticker/${item.ticker}`}
                  className="flex w-fit items-center gap-1 text-base font-semibold text-cyan-200 hover:text-cyan-100"
                  aria-label={`${item.direction === "UP" ? "Up" : "Down"} prediction for ${item.ticker}`}
                >
                  <span aria-hidden="true">{item.direction === "UP" ? "\u2191" : "\u2193"}</span>
                  <span>{formatTickerSymbol(item.ticker)}</span>
                </Link>
              </div>
              <PredictionReturnSummary prediction={item} href={`/predictions/${item.id}`} status={item.status} />
              {item.thesisTitle || item.thesis ? <Link href={`/predictions/${item.id}`} className="mt-3 block text-sm leading-6 text-slate-200 hover:text-cyan-100">
                {item.thesisTitle ? <p className="font-semibold">{item.thesisTitle}</p> : null}
                {item.thesis ? <p className="line-clamp-3 text-slate-300">{item.thesis}</p> : null}
              </Link> : null}
              {item.markPriceDate ? <p className="mt-2 text-xs text-slate-400">End-of-day price as of {item.markPriceDate.slice(0, 10)}</p> : null}
              <PredictionAuthorSummary author={item} className="mt-5" />
            </div>
          ))}

          {!loading && !error && items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
              No predictions yet.
            </p>
          ) : null}
        </div>

        {!loading && !error && isPreview ? (
          <section className="mt-4 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-5">
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">See more public calls</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Sign in to explore more than the top {previewLimit ?? 10} public calls and follow the ideas you care about.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/auth"
                className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Sign in to see more calls
              </Link>
              <Link
                href="/predictions/new"
                className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15"
              >
                Make your own call
              </Link>
            </div>
          </section>
        ) : null}

        {nextCursor ? (
          <div className="mt-4">
            {moreError ? <p role="alert" className="mb-2 text-sm text-rose-300">{moreError}</p> : null}
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full rounded-full border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 sm:w-auto"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
