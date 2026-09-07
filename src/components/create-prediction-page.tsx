"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { TickerSearchInput } from "@/components/ticker-search-input";
import { predictionSignInHref } from "@/lib/auth-continuation";
import { MAX_PREDICTION_THESIS_LENGTH, MAX_PREDICTION_THESIS_TITLE_LENGTH, type PredictionTimeHorizonUnit } from "@/lib/predictions/types";

function isValidTickerFormat(ticker: string): boolean {
  if (!ticker || ticker.length === 0 || ticker.length > 12) {
    return false;
  }
  return /^[A-Z0-9.\-]+$/.test(ticker);
}

type WatchlistOption = {
  id: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
};

export function CreatePredictionPage({
  requestedTicker = "",
  requestedWatchlistId = "",
}: {
  requestedTicker?: string;
  requestedWatchlistId?: string;
}) {
  const router = useRouter();
  const { user, loading, getIdToken, features } = useAuth();
  const [ticker, setTicker] = useState(requestedTicker.trim().toUpperCase());
  const [direction, setDirection] = useState<"UP" | "DOWN">("UP");
  const [thesisTitle, setThesisTitle] = useState("");
  const [thesis, setThesis] = useState("");
  const [watchlists, setWatchlists] = useState<WatchlistOption[]>([]);
  const [watchlistId, setWatchlistId] = useState("");
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [newWatchlistIsPublic, setNewWatchlistIsPublic] = useState(true);
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [timeHorizonUnit, setTimeHorizonUnit] = useState<"NONE" | PredictionTimeHorizonUnit>("NONE");
  const [timeHorizonValue, setTimeHorizonValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidTicker = isValidTickerFormat(ticker);
  const trimmedThesisTitleLength = thesisTitle.trim().length;
  const trimmedThesisLength = thesis.trim().length;
  const isValidThesisTitle =
    trimmedThesisTitleLength <= MAX_PREDICTION_THESIS_TITLE_LENGTH;
  const isValidThesis =
    trimmedThesisLength <= MAX_PREDICTION_THESIS_LENGTH;
  const isValidWatchlist = Boolean(watchlistId);
  const parsedTimeHorizonValue = Number(timeHorizonValue);
  const isValidTimeHorizon =
    timeHorizonUnit === "NONE" ||
    (Number.isInteger(parsedTimeHorizonValue) && parsedTimeHorizonValue > 0);
  const proFeaturesEnabled = features.proFeaturesEnabled;
  const canUsePro = features.canUsePro;
  const selectedWatchlist = useMemo(
    () => watchlists.find((item) => item.id === watchlistId) ?? null,
    [watchlistId, watchlists],
  );
  const tickerErrorMessage = ticker && !isValidTicker
    ? "Ticker must be 1-12 letters, numbers, dots, or hyphens."
    : null;
  const thesisErrorMessage =
    trimmedThesisLength > MAX_PREDICTION_THESIS_LENGTH
        ? `Thesis must be ${MAX_PREDICTION_THESIS_LENGTH} characters or fewer.`
        : null;
  const thesisTitleErrorMessage =
    thesisTitle && trimmedThesisTitleLength > MAX_PREDICTION_THESIS_TITLE_LENGTH
      ? `Title must be ${MAX_PREDICTION_THESIS_TITLE_LENGTH} characters or fewer.`
      : null;
  const timeHorizonErrorMessage =
    timeHorizonUnit !== "NONE" && !isValidTimeHorizon
      ? "Open until must be a positive whole number."
      : null;

  useEffect(() => {
    if (!user) {
      setWatchlists([]);
      setWatchlistId("");
      return;
    }

    let cancelled = false;
    void getIdToken()
      .then(async (token) => {
        const headers = token ? { authorization: `Bearer ${token}` } : undefined;
        const response = await fetch(`/api/watchlists?userId=${encodeURIComponent(user.uid)}`, { headers });
        if (!response.ok) {
          throw new Error("Unable to load watchlists.");
        }
        return (await response.json()) as { items: WatchlistOption[] };
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setWatchlists(payload.items);
        setWatchlistId((current) => {
          if (current && payload.items.some((watchlist) => watchlist.id === current)) {
            return current;
          }
          if (requestedWatchlistId && payload.items.some((watchlist) => watchlist.id === requestedWatchlistId)) {
            return requestedWatchlistId;
          }
          return payload.items[0]?.id || "";
        });
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load watchlists.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getIdToken, requestedWatchlistId, user]);

  if (loading) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-8 text-sm text-slate-300">Loading...</main>;
  }

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-6 text-center shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
          <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Sign in to create a prediction</h1>
          <p className="mb-6 text-sm text-slate-300">You need to be signed in to publish predictions and build your score.</p>
          <button
            type="button"
            onClick={() => router.push(predictionSignInHref(requestedTicker, requestedWatchlistId))}
            className="rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-900"
          >
            Sign in
          </button>
        </section>
      </main>
    );
  }

  async function submit() {
    setError(null);

    if (!isValidTicker) {
      setError("Invalid ticker format.");
      return;
    }

    if (!isValidThesisTitle) {
      setError(thesisTitleErrorMessage ?? "Invalid title.");
      return;
    }

    if (!isValidThesis) {
      setError(thesisErrorMessage ?? "Invalid thesis.");
      return;
    }

    if (!isValidWatchlist) {
      setError("Choose a watchlist for this prediction.");
      return;
    }

    if (!isValidTimeHorizon) {
      setError(timeHorizonErrorMessage ?? "Invalid open until period.");
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Authentication required.");
      return;
    }

    setSubmitting(true);

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
          watchlistId,
          thesisTitle,
          thesis,
          timeHorizon: timeHorizonUnit === "NONE"
            ? null
            : {
                value: parsedTimeHorizonValue,
                unit: timeHorizonUnit,
              },
        }),
      });

      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? "Failed to create prediction");
      }

      router.push(`/predictions/${payload.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create prediction");
    } finally {
      setSubmitting(false);
    }
  }

  async function createNewWatchlist() {
    setError(null);
    const name = newWatchlistName.trim();
    if (!name) {
      setError("Watchlist name is required.");
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Authentication required.");
      return;
    }

    setCreatingWatchlist(true);
    try {
      const response = await fetch("/api/watchlists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, isPublic: proFeaturesEnabled && canUsePro ? newWatchlistIsPublic : true }),
      });
      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? "Failed to create watchlist");
      }

      const next = { id: payload.id, name, isPublic: proFeaturesEnabled && canUsePro ? newWatchlistIsPublic : true };
      setWatchlists((current) => [...current, next]);
      setWatchlistId(payload.id);
      setNewWatchlistName("");
      setNewWatchlistIsPublic(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create watchlist");
    } finally {
      setCreatingWatchlist(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-6 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Create prediction</h1>
        <p className="mb-6 text-sm text-slate-300">Open your thesis with a direction. Entry price will be captured at next end of day (EOD) job.</p>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <TickerSearchInput
              value={ticker}
              onChange={setTicker}
              error={tickerErrorMessage}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-slate-200">Direction</label>
            <div className="inline-flex w-full rounded-full border border-white/15 p-1 sm:w-fit">
              {(["UP", "DOWN"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDirection(option)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-sm sm:flex-none ${direction === option ? "bg-cyan-400 text-slate-900" : "text-slate-200"}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-slate-200" htmlFor="watchlist">Watchlist</label>
            {watchlists.length > 0 ? (
              <select
                id="watchlist"
                value={watchlistId}
                onChange={(event) => setWatchlistId(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              >
                {watchlists.map((watchlist) => (
                  <option key={watchlist.id} value={watchlist.id}>
                    {watchlist.name}{watchlist.isPublic ? "" : " (Private)"}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-xl border border-dashed border-cyan-400/25 bg-cyan-500/5 px-3 py-2 text-sm text-slate-300">
                Create your first watchlist before publishing this prediction.
              </p>
            )}
            {selectedWatchlist && !selectedWatchlist.isPublic ? (
              <p className="text-xs text-amber-200">
                This watchlist is private, so this prediction will be private too.
              </p>
            ) : null}
            {watchlists.length < 5 ? (
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    type="text"
                    value={newWatchlistName}
                    onChange={(event) => setNewWatchlistName(event.target.value)}
                    maxLength={80}
                    placeholder="New watchlist name"
                    className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                  />
                  <button
                    type="button"
                    onClick={() => void createNewWatchlist()}
                    disabled={creatingWatchlist}
                    className="rounded-xl border border-cyan-400/35 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
                  >
                    {creatingWatchlist ? "Creating..." : "Create watchlist"}
                  </button>
                </div>
                {proFeaturesEnabled ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-slate-400">New watchlist visibility</span>
                    <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/70 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setNewWatchlistIsPublic(true)}
                        className={`rounded-full px-3 py-1.5 transition ${newWatchlistIsPublic ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"}`}
                      >
                        Public
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (canUsePro) {
                            setNewWatchlistIsPublic(false);
                          }
                        }}
                        disabled={!canUsePro}
                        className={`rounded-full px-3 py-1.5 transition ${!newWatchlistIsPublic ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"} ${!canUsePro ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        Private
                      </button>
                    </div>
                    {!canUsePro ? (
                      <p className="text-xs text-slate-400">
                        Private watchlists are part of Pro. Upgrade to unlock them.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-slate-200" htmlFor="time-horizon-unit">Open until (optional)</label>
            <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
              <select
                id="time-horizon-unit"
                value={timeHorizonUnit}
                onChange={(event) => {
                  const nextUnit = event.target.value as "NONE" | PredictionTimeHorizonUnit;
                  setTimeHorizonUnit(nextUnit);
                  if (nextUnit === "NONE") {
                    setTimeHorizonValue("");
                  }
                }}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              >
                <option value="NONE">No limit</option>
                <option value="DAYS">Days</option>
                <option value="MONTHS">Months</option>
                <option value="YEARS">Years</option>
              </select>
              <input
                type="number"
                min={1}
                step={1}
                value={timeHorizonValue}
                onChange={(event) => setTimeHorizonValue(event.target.value)}
                disabled={timeHorizonUnit === "NONE"}
                placeholder="Value"
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring disabled:opacity-50"
              />
            </div>
            <p className={`text-xs ${timeHorizonErrorMessage ? "text-rose-300" : "text-slate-400"}`}>
              Optional open window for this prediction.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-slate-200" htmlFor="thesis-title">Title</label>
            <input
              id="thesis-title"
              type="text"
              value={thesisTitle}
              onChange={(event) => setThesisTitle(event.target.value)}
              maxLength={MAX_PREDICTION_THESIS_TITLE_LENGTH}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              placeholder="Summarize the prediction"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className={thesisTitleErrorMessage ? "text-rose-300" : "text-slate-400"}>
                Optional.
              </p>
              <p className={trimmedThesisTitleLength > MAX_PREDICTION_THESIS_TITLE_LENGTH ? "text-rose-300" : "text-slate-400"}>
                {trimmedThesisTitleLength}/{MAX_PREDICTION_THESIS_TITLE_LENGTH}
              </p>
            </div>
            {thesisTitleErrorMessage ? <p className="text-xs text-rose-300">{thesisTitleErrorMessage}</p> : null}
          </div>

          <div className="grid gap-2">
            <label className="text-sm text-slate-200" htmlFor="prediction-thesis">Thesis</label>
            <textarea
              id="prediction-thesis"
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
              rows={10}
              maxLength={MAX_PREDICTION_THESIS_LENGTH}
              className="min-h-56 rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              placeholder="Optional thesis: explain why this setup should work"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {thesisErrorMessage ? <span /> : <p className="text-slate-400">Optional.</p>}
              <p className={trimmedThesisLength > MAX_PREDICTION_THESIS_LENGTH ? "text-rose-300" : "text-slate-400"}>
                {trimmedThesisLength}/{MAX_PREDICTION_THESIS_LENGTH}
              </p>
            </div>
            {thesisErrorMessage ? <p className="text-xs text-rose-300">{thesisErrorMessage}</p> : null}
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !isValidTicker || !isValidWatchlist || !isValidThesisTitle || !isValidThesis || !isValidTimeHorizon}
            className="w-full rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-60 sm:w-fit"
          >
            {submitting ? "Publishing..." : "Publish prediction"}
          </button>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
