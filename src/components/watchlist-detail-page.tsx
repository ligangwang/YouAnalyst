"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatTickerSymbol, PredictionReturnSummary } from "@/components/prediction-ui";
import { useAuth } from "@/components/providers/auth-provider";
import { type PredictionStatus } from "@/lib/predictions/types";
import { watchlistCanonicalPath, watchlistShareVersion } from "@/lib/watchlists/public-share";
import { xPostIntentUrl, xTrackedShareUrl } from "@/lib/x-share";

type WatchlistPrediction = {
  id: string;
  ticker: string;
  direction: "UP" | "DOWN";
  thesisTitle?: string;
  thesis: string;
  status: PredictionStatus;
  createdAt: string;
  entryPrice: number | null;
  entryDate: string | null;
  markPrice?: number | null;
  markPriceDate?: string | null;
  markReturnValue?: number | null;
  commentCount: number;
  result: {
    returnValue: number;
    score: number;
  } | null;
};

type WatchlistDetail = {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  metrics: {
    liveReturn: number | null;
    settledReturn: number | null;
    totalReturn: number | null;
    totalPredictionCount: number;
    livePredictionCount: number;
    settledPredictionCount: number;
    winRate: number | null;
  };
  viewerAccess: "preview" | "full";
  owner: {
    id: string;
    displayName: string | null;
    nickname: string | null;
    photoURL: string | null;
    stats: {
      totalScore: number;
      level: number;
      followersCount: number;
      settledCalls: number;
      winRate: number | null;
    };
  };
  livePredictions: WatchlistPrediction[];
  settledPredictions: WatchlistPrediction[];
};

type WatchlistRequestState = {
  watchlistId: string;
  watchlist: WatchlistDetail | null;
  loading: boolean;
  error: string | null;
};

function returnText(value: number | null): string {
  if (typeof value !== "number") {
    return "Not marked";
  }
  const percent = value * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function percentText(value: number | null): string {
  if (typeof value !== "number") {
    return "Not available";
  }
  return `${(value * 100).toFixed(0)}%`;
}

function ownerLabel(owner: WatchlistDetail["owner"]): string {
  return owner.nickname ? `@${owner.nickname}` : owner.displayName ?? "Anonymous analyst";
}

function watchlistShareUrl(watchlist: Pick<WatchlistDetail, "id" | "createdAt" | "updatedAt">): string {
  return xTrackedShareUrl({
    campaign: "watchlist_share",
    share: watchlistShareVersion(watchlist.id, watchlist),
    url: watchlistCanonicalPath(watchlist.id),
  });
}

function watchlistShareText(watchlist: WatchlistDetail): string {
  const liveCount = watchlist.metrics.livePredictionCount;
  const settledCount = watchlist.metrics.settledPredictionCount;
  const lines = [`Tracking ${watchlist.name} on my public YouAnalyst watchlist.`];

  if (watchlist.description?.trim()) {
    lines.push("", watchlist.description.trim());
  }

  if (typeof watchlist.metrics.liveReturn === "number") {
    lines.push("", `Current live return: ${returnText(watchlist.metrics.liveReturn)} across ${liveCount} live call${liveCount === 1 ? "" : "s"}.`);
  } else if (settledCount > 0) {
    lines.push("", `${liveCount} live call${liveCount === 1 ? "" : "s"} and ${settledCount} settled call${settledCount === 1 ? "" : "s"} on the board.`);
  } else {
    lines.push("", `${liveCount} live call${liveCount === 1 ? "" : "s"} on the board.`);
  }

  return lines.join("\n");
}

function watchlistShareIntentUrl(watchlist: WatchlistDetail): string {
  return xPostIntentUrl({
    text: watchlistShareText(watchlist),
    url: watchlistShareUrl(watchlist),
  });
}

function PredictionRow({ prediction }: { prediction: WatchlistPrediction }) {
  const title = prediction.thesisTitle?.trim();

  return (
    <article className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
      <Link
        href={`/ticker/${prediction.ticker}`}
        className="flex w-fit items-center gap-1 text-base font-semibold text-cyan-200 hover:text-cyan-100"
        aria-label={`${prediction.direction === "UP" ? "Up" : "Down"} prediction for ${prediction.ticker}`}
      >
        <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
        <span>{formatTickerSymbol(prediction.ticker)}</span>
      </Link>
      {title ? <p className="mt-2 text-sm font-medium text-slate-100">{title}</p> : null}
      <PredictionReturnSummary prediction={prediction} href={`/predictions/${prediction.id}`} status={prediction.status} />
    </article>
  );
}

export function WatchlistDetailPage({
  watchlistId,
}: {
  watchlistId: string;
}) {
  const { loading: authLoading, getIdToken } = useAuth();
  const [requestState, setRequestState] = useState<WatchlistRequestState>({
    watchlistId,
    watchlist: null,
    loading: true,
    error: null,
  });
  const [settledOpen, setSettledOpen] = useState(false);
  const isStaleRoute = requestState.watchlistId !== watchlistId;
  const loading = requestState.loading || isStaleRoute;
  const error = isStaleRoute ? null : requestState.error;
  const watchlist = isStaleRoute ? null : requestState.watchlist;

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    async function loadWatchlist() {
      const token = await getIdToken();
      const response = await fetch(`/api/watchlists/${watchlistId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });

      if (!response.ok) {
        throw new Error("Unable to load watchlist.");
      }

      return (await response.json()) as { watchlist: WatchlistDetail };
    }

    void loadWatchlist()
      .then(async (response) => {
        if (!cancelled) {
          setRequestState({
            watchlistId,
            watchlist: response.watchlist,
            loading: false,
            error: null,
          });
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setRequestState({
            watchlistId,
            watchlist: null,
            loading: false,
            error: nextError instanceof Error ? nextError.message : "Unable to load watchlist.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, watchlistId]);

  if (loading || authLoading) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-slate-300">Loading watchlist...</main>;
  }

  if (!watchlist || error) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-rose-300">{error ?? "Watchlist not found."}</main>;
  }

  const isPreview = watchlist.viewerAccess === "preview";
  const previewPredictions = [...watchlist.livePredictions, ...watchlist.settledPredictions];
  const hiddenPredictionCount = Math.max(0, watchlist.metrics.totalPredictionCount - previewPredictions.length);
  const hasPreviewPredictions = previewPredictions.length > 0;

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">{watchlist.name}</h1>
            {watchlist.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{watchlist.description}</p> : null}
          </div>
          {watchlist.isPublic ? (
            <div className="flex flex-wrap gap-2">
              {isPreview ? null : (
                <Link
                  href={`/analysts/${watchlist.owner.id}`}
                  className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15"
                >
                  Analyst profile
                </Link>
              )}
              <a
                href={watchlistShareIntentUrl(watchlist)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Share to X
              </a>
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4">
          {watchlist.owner.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={watchlist.owner.photoURL}
              alt=""
              className="h-11 w-11 rounded-full border border-cyan-500/50 object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-500/50 bg-cyan-500/20 text-sm font-semibold text-cyan-100">
              {ownerLabel(watchlist.owner).replace(/^@/, "").slice(0, 1).toUpperCase() || "A"}
            </div>
          )}
          <div>
            <Link href={`/analysts/${watchlist.owner.id}`} className="text-sm font-semibold text-cyan-100 hover:text-cyan-50">
              {ownerLabel(watchlist.owner)}
            </Link>
            <p className="mt-0.5 text-xs text-slate-400">
              Level {watchlist.owner.stats.level} &middot; {watchlist.owner.stats.followersCount.toLocaleString()} followers &middot; {watchlist.owner.stats.settledCalls.toLocaleString()} settled calls
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total predictions</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{watchlist.metrics.totalPredictionCount.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Open predictions</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{watchlist.metrics.livePredictionCount.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Settled predictions</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{watchlist.metrics.settledPredictionCount.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total return</p>
          <p className="mt-1 text-xl font-semibold text-cyan-100">{returnText(watchlist.metrics.totalReturn)}</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Live return</p>
          <p className="mt-1 text-xl font-semibold text-cyan-100">{returnText(watchlist.metrics.liveReturn)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Win rate</p>
          <p className="mt-1 text-xl font-semibold text-cyan-100">{percentText(watchlist.metrics.winRate)}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">
              {isPreview ? "Preview predictions" : "Live predictions"}
            </h2>
            {isPreview ? (
              <p className="mt-1 text-sm text-slate-400">First 3 public predictions are visible before sign-in.</p>
            ) : null}
          </div>
          {!isPreview ? (
            <Link
              href={`/predictions/new?watchlistId=${encodeURIComponent(watchlist.id)}`}
              className="text-sm font-semibold text-cyan-300 hover:text-cyan-200"
            >
              Make your call on this theme
            </Link>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3">
          {watchlist.livePredictions.map((prediction) => (
            <PredictionRow key={prediction.id} prediction={prediction} />
          ))}
          {isPreview ? watchlist.settledPredictions.map((prediction) => (
            <PredictionRow key={prediction.id} prediction={prediction} />
          )) : null}
          {(isPreview ? !hasPreviewPredictions : watchlist.livePredictions.length === 0) ? (
            <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
              {isPreview ? "No preview predictions in this watchlist." : "No live predictions in this watchlist."}
            </p>
          ) : null}
        </div>
      </section>

      {isPreview ? (
        <section className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-5">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Unlock the full watchlist</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Sign in to view all public calls, full watchlist history, and performance details.
            {hiddenPredictionCount > 0 ? ` ${hiddenPredictionCount.toLocaleString()} more call${hiddenPredictionCount === 1 ? "" : "s"} are waiting behind this preview.` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/auth"
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            >
              Sign in to unlock full watchlist
            </Link>
            <Link
              href="/predictions/new"
              className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15"
            >
              Make your own call
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <button
          type="button"
          onClick={() => setSettledOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Settled predictions</span>
          <span className="text-sm text-cyan-300">{settledOpen ? "Hide" : "Show"}</span>
        </button>
        {settledOpen ? (
          <div className="mt-4 grid gap-3">
            {watchlist.settledPredictions.map((prediction) => (
              <PredictionRow key={prediction.id} prediction={prediction} />
            ))}
            {watchlist.settledPredictions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
                No settled predictions in this watchlist.
              </p>
            ) : null}
          </div>
        ) : null}
        </section>
      )}
    </main>
  );
}
