"use client";

import { UiText, useUiText } from "@/components/ui-text";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { formatTickerSymbol, PredictionReturnSummary } from "@/components/prediction-ui";
import { type PredictionStatus } from "@/lib/predictions/types";

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

type WatchlistMetrics = {
  liveReturn: number | null;
  settledReturn: number | null;
  livePredictionCount: number;
  settledPredictionCount: number;
};

type WatchlistSummary = {
  id: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  metrics: WatchlistMetrics;
};

type WatchlistDetail = {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  metrics: WatchlistMetrics;
  livePredictions: WatchlistPrediction[];
  settledPredictions: WatchlistPrediction[];
};

type StatusFilter = "ALL" | "LIVE" | "SETTLED";

function watchlistReturnText(value: number | null): string {
  if (typeof value !== "number") {
    return "Not marked";
  }
  const percent = value * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function statusFilterLabel(status: StatusFilter): string {
  if (status === "LIVE") {
    return "Live";
  }
  if (status === "SETTLED") {
    return "Settled";
  }
  return "All";
}

function predictionStatusLabel(status: PredictionStatus): string {
  if (status === "CREATED") {
    return "Awaiting entry";
  }
  if (status === "OPEN") {
    return "Live";
  }
  if (status === "CLOSING") {
    return "Closing";
  }
  if (status === "SETTLED") {
    return "Settled";
  }
  return "Canceled";
}

function WatchlistPredictionRow({ prediction }: { prediction: WatchlistPrediction }) {
  const title = prediction.thesisTitle?.trim();

  return (
    <article className="border-t border-white/10 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/predictions/${prediction.id}`}
            className="flex w-fit items-center gap-1 text-base font-semibold text-cyan-200 hover:text-cyan-100"
          >
            <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
            <span>{formatTickerSymbol(prediction.ticker)}</span>
          </Link>
          {title ? <p className="mt-1 truncate text-sm text-slate-300">{title}</p> : null}
          <PredictionReturnSummary prediction={prediction} href={`/predictions/${prediction.id}`} status={prediction.status} />
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500">
          <p>{<UiText text={predictionStatusLabel(prediction.status)} />}</p>
          <p className="mt-1">{prediction.commentCount.toLocaleString()}<UiText text={" comments"} /></p>
        </div>
      </div>
    </article>
  );
}

export function MyWatchlistsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const ui = useUiText();
  const { user, loading: authLoading, getIdToken, features } = useAuth();
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistDetail | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [composerOpen, setComposerOpen] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [newWatchlistDescription, setNewWatchlistDescription] = useState("");
  const [newWatchlistIsPublic, setNewWatchlistIsPublic] = useState(true);
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsPublic, setEditIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddUpTickers, setQuickAddUpTickers] = useState("");
  const [quickAddDownTickers, setQuickAddDownTickers] = useState("");
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const [quickAddMessage, setQuickAddMessage] = useState<string | null>(null);
  const watchlistRequestIdRef = useRef(0);
  const proFeaturesEnabled = features.proFeaturesEnabled;
  const canUsePro = features.canUsePro;

  const selectedSummary = useMemo(
    () => watchlists.find((item) => item.id === selectedWatchlistId) ?? null,
    [selectedWatchlistId, watchlists],
  );
  const selectedWatchlistLockedPublic = Boolean((watchlist?.isPublic ?? selectedSummary?.isPublic) === true);
  const selectedMetrics = watchlist?.metrics ?? selectedSummary?.metrics ?? null;
  const selectedPredictions =
    watchlist && status === "LIVE"
      ? watchlist.livePredictions
      : watchlist && status === "SETTLED"
        ? watchlist.settledPredictions
        : watchlist
          ? [...watchlist.livePredictions, ...watchlist.settledPredictions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : [];

  async function loadWatchlistDetail(nextWatchlistId: string) {
    const requestId = watchlistRequestIdRef.current + 1;
    watchlistRequestIdRef.current = requestId;
    setSelectedWatchlistId(nextWatchlistId);
    setLoadingDetail(true);
    setError(null);

    try {
      const token = await getIdToken();
      const headers = token ? { authorization: `Bearer ${token}` } : undefined;
      const response = await fetch(`/api/watchlists/${nextWatchlistId}`, { headers });
      if (!response.ok) {
        throw new Error("Unable to load watchlist.");
      }

      const payload = (await response.json()) as { watchlist: WatchlistDetail };
      if (watchlistRequestIdRef.current !== requestId) {
        return;
      }
      setWatchlist(payload.watchlist);
      setEditName(payload.watchlist.name);
      setEditDescription(payload.watchlist.description ?? "");
      setEditIsPublic(payload.watchlist.isPublic);
    } catch (nextError) {
      if (watchlistRequestIdRef.current !== requestId) {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to load watchlist.");
      setWatchlist(null);
    } finally {
      if (watchlistRequestIdRef.current === requestId) {
        setLoadingDetail(false);
      }
    }
  }

  async function loadWorkspace(ownerId: string, preferredWatchlistId?: string | null) {
    setLoadingWorkspace(true);
    setError(null);

    try {
      const token = await getIdToken();
      const headers = token ? { authorization: `Bearer ${token}` } : undefined;
      const response = await fetch(`/api/watchlists?userId=${encodeURIComponent(ownerId)}`, { headers });
      if (!response.ok) {
        throw new Error("Unable to load watchlists.");
      }

      const payload = (await response.json()) as { items: WatchlistSummary[] };
      setWatchlists(payload.items);

      const fallbackId =
        (preferredWatchlistId && payload.items.some((item) => item.id === preferredWatchlistId) ? preferredWatchlistId : null) ??
        (selectedWatchlistId && payload.items.some((item) => item.id === selectedWatchlistId) ? selectedWatchlistId : null) ??
        payload.items[0]?.id ??
        null;

      if (fallbackId) {
        await loadWatchlistDetail(fallbackId);
      } else {
        setSelectedWatchlistId(null);
        setWatchlist(null);
        setEditName("");
        setEditDescription("");
        setEditIsPublic(true);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load watchlists.");
      setWatchlists([]);
      setSelectedWatchlistId(null);
      setWatchlist(null);
      setEditIsPublic(true);
    } finally {
      setLoadingWorkspace(false);
    }
  }

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      watchlistRequestIdRef.current += 1;
      setWatchlists([]);
      setSelectedWatchlistId(null);
      setWatchlist(null);
      setEditName("");
      setEditDescription("");
      setNewWatchlistIsPublic(true);
      setEditIsPublic(true);
      setComposerOpen(false);
      setEditing(false);
      setQuickAddOpen(false);
      setQuickAddUpTickers("");
      setQuickAddDownTickers("");
      setQuickAddMessage(null);
      setError(null);
      setLoadingWorkspace(false);
      setLoadingDetail(false);
      return;
    }

    void loadWorkspace(user.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.uid]);

  async function createWatchlist() {
    if (!user) {
      setError("Sign in to create a watchlist.");
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Sign in to create a watchlist.");
      return;
    }

    const name = newWatchlistName.trim();
    const description = newWatchlistDescription.trim();
    if (!name) {
      setError("Watchlist name is required.");
      return;
    }

    setCreatingWatchlist(true);
    setError(null);

    try {
      const response = await fetch("/api/watchlists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          description: description || null,
          isPublic: proFeaturesEnabled && canUsePro ? newWatchlistIsPublic : true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? "Failed to create watchlist.");
      }

      setNewWatchlistName("");
      setNewWatchlistDescription("");
      setNewWatchlistIsPublic(true);
      setComposerOpen(false);
      await loadWorkspace(user.uid, payload.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create watchlist.");
    } finally {
      setCreatingWatchlist(false);
    }
  }

  function startEditing() {
    if (!watchlist) {
      return;
    }

    setEditName(watchlist.name);
    setEditDescription(watchlist.description ?? "");
    setEditIsPublic(watchlist.isPublic);
    setEditing(true);
    setError(null);
  }

  async function saveWatchlist() {
    if (!user || !watchlist) {
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Sign in to edit this watchlist.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/watchlists/${watchlist.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          isPublic: proFeaturesEnabled && canUsePro ? editIsPublic : true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update watchlist.");
      }

      setEditing(false);
      await loadWorkspace(user.uid, watchlist.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update watchlist.");
    } finally {
      setSaving(false);
    }
  }

  function parseTickerList(raw: string): string[] {
    return Array.from(
      new Set(
        raw
          .split(",")
          .map((ticker) => ticker.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }

  async function quickAddPredictions() {
    if (!user || !selectedWatchlistId) {
      setError("Choose a watchlist first.");
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Sign in to add predictions.");
      return;
    }

    const upTickers = parseTickerList(quickAddUpTickers);
    const downTickers = parseTickerList(quickAddDownTickers);
    const duplicates = upTickers.filter((ticker) => downTickers.includes(ticker));

    if (upTickers.length === 0 && downTickers.length === 0) {
      setError("Enter at least one ticker in UP or DOWN.");
      return;
    }

    if (duplicates.length > 0) {
      setError(`Tickers must belong to only one direction: ${duplicates.join(", ")}`);
      return;
    }

    setQuickAddSubmitting(true);
    setError(null);
    setQuickAddMessage(null);

    const requests = [
      ...upTickers.map((ticker) => ({ ticker, direction: "UP" as const })),
      ...downTickers.map((ticker) => ({ ticker, direction: "DOWN" as const })),
    ];

    const results = await Promise.all(
      requests.map(async ({ ticker, direction }) => {
        try {
          const response = await fetch("/api/predictions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              ticker,
              direction,
              watchlistId: selectedWatchlistId,
              thesisTitle: "",
              thesis: "",
              timeHorizon: null,
            }),
          });

          const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
          if (!response.ok || !payload.id) {
            return { ticker, ok: false, message: payload.error ?? "Failed to create prediction." };
          }

          return { ticker, ok: true, message: "" };
        } catch (nextError) {
          return {
            ticker,
            ok: false,
            message: nextError instanceof Error ? nextError.message : "Failed to create prediction.",
          };
        }
      }),
    );

    const succeeded = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);

    if (succeeded.length > 0) {
      setQuickAddUpTickers("");
      setQuickAddDownTickers("");
      setQuickAddOpen(false);
      await loadWorkspace(user.uid, selectedWatchlistId);
    }

    if (failed.length > 0) {
      setError(failed.map((result) => `${result.ticker}: ${result.message}`).join(" | "));
    }

    if (succeeded.length > 0) {
      setQuickAddMessage(
        failed.length > 0
          ? `Created ${succeeded.length} prediction${succeeded.length === 1 ? "" : "s"} with ${failed.length} skipped.`
          : `Created ${succeeded.length} prediction${succeeded.length === 1 ? "" : "s"}.`,
      );
    } else if (failed.length > 0) {
      setQuickAddMessage("No predictions were created.");
    }

    setQuickAddSubmitting(false);
  }

  if (!user) {
    const content = (
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-6 text-center shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"My Watchlists"} /></h1>
        <p className="mt-3 text-sm text-slate-300"><UiText text={"Sign in to create watchlists, organize predictions, and manage your research workspace."} /></p>
        <Link
          href="/auth"
          className="mt-6 inline-flex rounded-full bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        ><UiText text={"Sign in"} /></Link>
      </section>
    );

    if (embedded) {
      return content;
    }

    return <main className="mx-auto w-full max-w-4xl px-4 py-8">{content}</main>;
  }

  if (authLoading || loadingWorkspace) {
    if (embedded) {
      return <div className="py-4 text-sm text-slate-300"><UiText text={"Loading watchlists..."} /></div>;
    }

    return <main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm text-slate-300"><UiText text={"Loading watchlists..."} /></main>;
  }

  const content = (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-cyan-300"><UiText text={"Workspace"} /></p>
            <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"My Watchlists"} /></h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              {proFeaturesEnabled
                ? <UiText text={"Create, edit, and review the public and private watchlists that organize your predictions."} />
                : <UiText text={"Create, edit, and review the public watchlists that organize your predictions."} />}
            </p>
            {proFeaturesEnabled && !canUsePro ? (
              <p className="mt-2 text-xs text-amber-200"><UiText text={"Private watchlists are part of Pro. Upgrade to unlock private tracking."} /></p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlists.length < 5 ? (
              <button
                type="button"
                onClick={() => {
                  setComposerOpen((current) => !current);
                  setError(null);
                }}
                className="rounded-full border border-cyan-400/35 px-3 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15"
              >
                {composerOpen ? <UiText text={"Close"} /> : <UiText text={"New watchlist"} />}
              </button>
            ) : null}
            <Link
              href={selectedWatchlistId ? `/predictions/new?watchlistId=${encodeURIComponent(selectedWatchlistId)}` : "/predictions/new"}
              className="rounded-full bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            ><UiText text={"Add prediction"} /></Link>
          </div>
        </div>

        {composerOpen ? (
          <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="text"
                value={newWatchlistName}
                onChange={(event) => setNewWatchlistName(event.target.value)}
                maxLength={80}
                placeholder={ui("Watchlist name")}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
              <input
                type="text"
                value={newWatchlistDescription}
                onChange={(event) => setNewWatchlistDescription(event.target.value)}
                maxLength={240}
                placeholder={ui("Optional description")}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
              <button
                type="button"
                onClick={() => void createWatchlist()}
                disabled={creatingWatchlist}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
              >
                {creatingWatchlist ? <UiText text={"Creating..."} /> : <UiText text={"Create"} />}
              </button>
            </div>
            {proFeaturesEnabled ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-400"><UiText text={"New watchlist visibility"} /></span>
                <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/70 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setNewWatchlistIsPublic(true)}
                    className={`rounded-full px-3 py-1.5 transition ${newWatchlistIsPublic ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"}`}
                  ><UiText text={"Public"} /></button>
                  <button
                    type="button"
                    onClick={() => {
                      if (canUsePro) {
                        setNewWatchlistIsPublic(false);
                      }
                    }}
                    disabled={!canUsePro}
                    className={`rounded-full px-3 py-1.5 transition ${!newWatchlistIsPublic ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"} ${!canUsePro ? "cursor-not-allowed opacity-50" : ""}`}
                  ><UiText text={"Private"} /></button>
                </div>
                {!canUsePro ? (
                  <p className="text-xs text-slate-400"><UiText text={"Private watchlists unlock with Pro."} /></p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-rose-300">{<UiText text={error} />}</p> : null}
      </section>

      {watchlists.length > 0 ? (
        <>
          <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
            <div className="flex flex-wrap gap-2">
              {watchlists.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadWatchlistDetail(item.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    selectedWatchlistId === item.id
                      ? "bg-cyan-500 text-slate-950"
                      : "border border-white/10 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100"
                  }`}
                >
                  {item.name}{item.isPublic ? "" : <UiText text={" (Private)"} />}
                </button>
              ))}
            </div>
          </section>

          {selectedSummary ? (
            <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
              {editing ? (
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <label className="text-xs text-slate-400" htmlFor="edit-watchlist-name"><UiText text={"Name"} /></label>
                    <input
                      id="edit-watchlist-name"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      maxLength={80}
                      className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-xs text-slate-400" htmlFor="edit-watchlist-description"><UiText text={"Description"} /></label>
                    <textarea
                      id="edit-watchlist-description"
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      maxLength={500}
                      rows={3}
                      className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                    />
                  </div>
                  {proFeaturesEnabled ? (
                    <div className="grid gap-1">
                      <span className="text-xs text-slate-400"><UiText text={"Visibility"} /></span>
                      <div className="inline-flex w-fit rounded-full border border-slate-700 bg-slate-900/70 p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => setEditIsPublic(true)}
                          className={`rounded-full px-3 py-1.5 transition ${editIsPublic ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"}`}
                        ><UiText text={"Public"} /></button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedWatchlistLockedPublic && canUsePro) {
                              setEditIsPublic(false);
                            }
                          }}
                          disabled={selectedWatchlistLockedPublic || !canUsePro}
                          className={`rounded-full px-3 py-1.5 transition ${!editIsPublic ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"} ${selectedWatchlistLockedPublic || !canUsePro ? "cursor-not-allowed opacity-50" : ""}`}
                        ><UiText text={"Private"} /></button>
                      </div>
                      {selectedWatchlistLockedPublic ? (
                        <p className="text-xs text-slate-400"><UiText text={"Public watchlists stay public once shared. Close predictions you no longer want to continue publicly, then use a private watchlist for new ideas."} /></p>
                      ) : !canUsePro ? (
                        <p className="text-xs text-slate-400"><UiText text={"Private watchlists are part of Pro. Upgrade to move this watchlist into your private workspace."} /></p>
                      ) : editIsPublic ? (
                        <p className="text-xs text-slate-400"><UiText text={"Once this watchlist is public, it stays public as part of your track record."} /></p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveWatchlist()}
                      disabled={saving}
                      className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                    >
                      {saving ? <UiText text={"Saving..."} /> : <UiText text={"Save"} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEditName(watchlist?.name ?? selectedSummary.name);
                        setEditDescription(watchlist?.description ?? selectedSummary.description ?? "");
                        setEditIsPublic(watchlist?.isPublic ?? selectedSummary.isPublic);
                      }}
                      disabled={saving}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:border-white/30 disabled:opacity-60"
                    ><UiText text={"Cancel"} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
                        {selectedSummary.name}
                      </h2>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-300">
                        {selectedSummary.isPublic ? <UiText text={"Public"} /> : <UiText text={"Private"} />}
                      </span>
                      {selectedSummary.isPublic ? (
                        <Link
                          href={`/analysts/${user.uid}/watchlists/${selectedSummary.id}`}
                          className="text-xs font-medium text-cyan-300 hover:text-cyan-100"
                        ><UiText text={"View public page"} /></Link>
                      ) : null}
                    </div>
                    {selectedSummary.description ? (
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{selectedSummary.description}</p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-400"><UiText text={"No description yet."} /></p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startEditing}
                      className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
                    ><UiText text={"Edit watchlist"} /></button>
                    <Link
                      href={selectedWatchlistId ? `/predictions/new?watchlistId=${encodeURIComponent(selectedWatchlistId)}` : "/predictions/new"}
                      className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                    ><UiText text={"Add prediction"} /></Link>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickAddOpen((current) => !current);
                        setQuickAddMessage(null);
                        setError(null);
                      }}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:border-white/30"
                    >
                      {quickAddOpen ? <UiText text={"Close quick add"} /> : <UiText text={"Quick add"} />}
                    </button>
                  </div>
                </div>
              )}

              {quickAddOpen ? (
                <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
                  <div className="mb-3">
                    <h3 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Quick add predictions"} /></h3>
                    <p className="mt-1 text-sm text-slate-300"><UiText text={"Enter comma-separated tickers by direction. Thesis is optional, so these predictions will be created without a title or thesis."} /></p>
                    {!selectedSummary.isPublic ? (
                      <p className="mt-2 text-xs text-amber-200"><UiText text={"This watchlist is private, so quick-added predictions will be private too."} /></p>
                    ) : null}
                  </div>
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <label className="text-xs text-slate-400" htmlFor="quick-add-up"><UiText text={"UP tickers"} /></label>
                      <textarea
                        id="quick-add-up"
                        value={quickAddUpTickers}
                        onChange={(event) => setQuickAddUpTickers(event.target.value)}
                        rows={2}
                        placeholder="NVDA, AMD, AVGO"
                        className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                      />
                    </div>
                    <div className="grid gap-1">
                      <label className="text-xs text-slate-400" htmlFor="quick-add-down"><UiText text={"DOWN tickers"} /></label>
                      <textarea
                        id="quick-add-down"
                        value={quickAddDownTickers}
                        onChange={(event) => setQuickAddDownTickers(event.target.value)}
                        rows={2}
                        placeholder="TSLA, AAPL"
                        className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void quickAddPredictions()}
                        disabled={quickAddSubmitting}
                        className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                      >
                        {quickAddSubmitting ? <UiText text={"Creating..."} /> : <UiText text={"Create predictions"} />}
                      </button>
                      <p className="text-xs text-slate-400"><UiText text={"One ticker can only appear in one direction row."} /></p>
                    </div>
                    {quickAddMessage ? <p className="text-sm text-emerald-300">{<UiText text={quickAddMessage} />}</p> : null}
                  </div>
                </div>
              ) : null}

              {selectedMetrics ? (
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500"><UiText text={"Live return"} /></p>
                    <p className="mt-1 font-semibold text-cyan-100">{watchlistReturnText(selectedMetrics.liveReturn)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500"><UiText text={"Settled return"} /></p>
                    <p className="mt-1 font-semibold text-cyan-100">{watchlistReturnText(selectedMetrics.settledReturn)}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500"><UiText text={"Live"} /></p>
                    <p className="mt-1 font-semibold text-slate-100">{selectedMetrics.livePredictionCount.toLocaleString()}<UiText text={" predictions"} /></p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500"><UiText text={"Settled"} /></p>
                    <p className="mt-1 font-semibold text-slate-100">{selectedMetrics.settledPredictionCount.toLocaleString()}<UiText text={" predictions"} /></p>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Predictions"} /></h3>
                <div className="inline-flex rounded-full border border-slate-700 bg-slate-800/70 p-1 text-xs">
                  {(["ALL", "LIVE", "SETTLED"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setStatus(option)}
                      className={`rounded-full px-3 py-1.5 transition ${
                        status === option ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"
                      }`}
                    >
                      {<UiText text={statusFilterLabel(option)} />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                {loadingDetail ? (
                  <p className="text-sm text-slate-300"><UiText text={"Loading watchlist..."} /></p>
                ) : selectedPredictions.length > 0 ? (
                  <div>
                    {selectedPredictions.map((prediction) => (
                      <WatchlistPredictionRow key={prediction.id} prediction={prediction} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-300">
                    {status === "LIVE"
                      ? <UiText text={"No live predictions in this watchlist."} />
                      : status === "SETTLED"
                        ? <UiText text={"No settled predictions in this watchlist."} />
                        : <UiText text={"No predictions in this watchlist yet."} />}
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
          <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300"><UiText text={"Create your first watchlist to organize your predictions."} /></p>
        </section>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return <main className="mx-auto w-full max-w-6xl px-4 py-8">{content}</main>;
}
