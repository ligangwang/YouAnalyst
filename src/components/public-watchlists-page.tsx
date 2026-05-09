import Image from "next/image";
import Link from "next/link";
import { formatTickerSymbol, PredictionReturnSummary } from "@/components/prediction-ui";
import type { PublicWatchlistSummary } from "@/lib/watchlists/service";

function predictionStatusLabel(status: PublicWatchlistSummary["previewPredictions"][number]["status"]): string {
  if (status === "CREATED") {
    return "Awaiting entry";
  }
  if (status === "OPEN") {
    return "Live";
  }
  if (status === "CLOSING") {
    return "Closing";
  }
  return "Settled";
}

function WatchlistPreviewRow({
  prediction,
  watchlistId,
}: {
  prediction: PublicWatchlistSummary["previewPredictions"][number];
  watchlistId: string;
}) {
  return (
    <article className="border-t border-white/10 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/predictions/${prediction.id}`}
            className="flex w-fit items-center gap-1 text-sm font-semibold text-cyan-200 hover:text-cyan-100"
            aria-label={`${prediction.direction === "UP" ? "Up" : "Down"} prediction for ${prediction.ticker} in watchlist ${watchlistId}`}
          >
            <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
            <span>{formatTickerSymbol(prediction.ticker)}</span>
          </Link>
          <PredictionReturnSummary prediction={prediction} href={`/predictions/${prediction.id}`} status={prediction.status} />
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500">
          <p>{predictionStatusLabel(prediction.status)}</p>
          <p className="mt-1">{prediction.commentCount.toLocaleString()} comments</p>
        </div>
      </div>
    </article>
  );
}

function hiddenPredictionCount(watchlist: PublicWatchlistSummary): number {
  const totalPredictions = watchlist.metrics.livePredictionCount + watchlist.metrics.settledPredictionCount;
  return Math.max(0, totalPredictions - watchlist.previewPredictions.length);
}

function groupWatchlistsByOwner(watchlists: PublicWatchlistSummary[]) {
  const grouped = new Map<string, { owner: PublicWatchlistSummary["owner"]; watchlists: PublicWatchlistSummary[] }>();

  watchlists.forEach((watchlist) => {
    const existing = grouped.get(watchlist.owner.id);
    if (existing) {
      existing.watchlists.push(watchlist);
      return;
    }

    grouped.set(watchlist.owner.id, {
      owner: watchlist.owner,
      watchlists: [watchlist],
    });
  });

  return Array.from(grouped.values());
}

export function PublicWatchlistsPage({
  watchlists,
  embedded = false,
  showHeader = true,
}: {
  watchlists: PublicWatchlistSummary[];
  embedded?: boolean;
  showHeader?: boolean;
}) {
  const groupedWatchlists = groupWatchlistsByOwner(watchlists);
  const content = (
    <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-4 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
      {showHeader ? (
        <div className="mb-4">
          <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">Community Watchlists</h1>
          <p className="mt-1 text-sm text-slate-300">Best-performing public watchlists, with newer watchlists breaking ties.</p>
        </div>
      ) : null}

      {groupedWatchlists.length > 0 ? (
        <div className="grid gap-3">
          {groupedWatchlists.map((group) => {

            return (
              <article
                key={group.owner.id}
                className="rounded-xl border border-white/10 bg-slate-950/55 p-4 transition hover:border-cyan-300/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <Link
                    href={`/analysts/${group.owner.id}`}
                    className="flex min-w-0 items-center gap-3 hover:opacity-90"
                  >
                    {group.owner.photoURL ? (
                      <Image
                        src={group.owner.photoURL}
                        alt={group.owner.nickname ? `@${group.owner.nickname}` : group.owner.displayName ?? "Analyst"}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full object-cover ring-1 ring-cyan-400/30"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cyan-500/20 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-400/30">
                        {(group.owner.nickname ?? group.owner.displayName ?? "A").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-cyan-200">
                        {group.owner.nickname ? `@${group.owner.nickname}` : group.owner.displayName ?? "Analyst"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {group.watchlists.length === 1 ? "1 public watchlist" : `${group.watchlists.length} public watchlists`}
                      </p>
                    </div>
                  </Link>
                </div>

                <div className="mt-4 grid gap-3">
                  {group.watchlists.map((watchlist) => {
                    const hiddenPredictions = hiddenPredictionCount(watchlist);

                    return (
                      <section key={watchlist.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-white">{watchlist.name}</p>
                          </div>
                          <Link
                            href={`/analysts/${watchlist.owner.id}/watchlists/${watchlist.id}`}
                            className="shrink-0 text-xs font-medium text-cyan-300 hover:text-cyan-100"
                          >
                            View watchlist
                          </Link>
                        </div>
                        <div className="mt-4">
                          {watchlist.previewPredictions.length > 0 ? (
                            <div>
                              {watchlist.previewPredictions.map((prediction) => (
                                <WatchlistPreviewRow key={prediction.id} prediction={prediction} watchlistId={watchlist.id} />
                              ))}
                              {hiddenPredictions > 0 ? (
                                <div className="mt-3 border-t border-white/10 pt-3">
                                  <Link
                                    href={`/analysts/${watchlist.owner.id}/watchlists/${watchlist.id}`}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
                                    aria-label={`View ${hiddenPredictions} more predictions in ${watchlist.name}`}
                                  >
                                    <span aria-hidden="true">...</span>
                                    <span>{hiddenPredictions} more</span>
                                  </Link>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-300">No predictions in this watchlist yet.</p>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No public watchlists yet.
        </p>
      )}
    </section>
  );

  if (embedded) {
    return content;
  }

  return <main className="mx-auto w-full max-w-6xl px-4 py-5">{content}</main>;
}
