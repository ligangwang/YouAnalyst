"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { PredictionPriceChart, type PredictionPriceHistory } from "@/components/prediction-price-chart";
import { formatCashtag, formatPredictionStatus, formatPredictionThesisTitle, formatReturnPercent, formatTickerSymbol, markToneClass, PredictionAuthorSummary, PredictionThesisText, RelativeTime } from "@/components/prediction-ui";
import {
  MAX_PREDICTION_THESIS_LENGTH,
  MAX_PREDICTION_THESIS_TITLE_LENGTH,
  sanitizePredictionThesis,
  type PredictionStatus,
  type PredictionTimeHorizon,
  type PredictionTimeHorizonUnit,
  type PredictionVisibility,
} from "@/lib/predictions/types";
import { xPostIntentUrl } from "@/lib/x-share";

type PredictionDetail = {
  id: string;
  userId: string;
  authorDisplayName: string | null;
  authorNickname: string | null;
  authorPhotoURL?: string | null;
  authorStats?: {
    level?: number | null;
    totalPredictions?: number | null;
  } | null;
  ticker: string;
  direction: "UP" | "DOWN";
  watchlistId?: string | null;
  watchlistName?: string | null;
  entryPrice: number | null;
  entryDate: string | null;
  thesisTitle: string;
  thesis: string;
  timeHorizon: PredictionTimeHorizon | null;
  status: PredictionStatus;
  visibility?: PredictionVisibility;
  createdAt: string;
  updatedAt?: string | null;
  closeRequestedAt?: string | null;
  closeTargetDate?: string | null;
  closeReason?: string | null;
  markPrice?: number | null;
  markPriceDate?: string | null;
  markReturnValue?: number | null;
  commentCount: number;
  result: {
    score: number;
    exitPrice: number;
    returnValue: number;
  } | null;
};

type WatchlistOption = {
  id: string;
  name: string;
  isPublic: boolean;
};

type PredictionComment = {
  id: string;
  predictionId: string;
  authorDisplayName: string | null;
  authorNickname: string | null;
  content: string;
  createdAt: string;
};

const DETAIL_CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const DETAIL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDetailCurrency(value: number | null | undefined): string {
  return typeof value === "number" ? DETAIL_CURRENCY_FORMATTER.format(value) : "Pending";
}

function formatDetailDate(value: string | null | undefined): string {
  if (!value) {
    return "Pending";
  }

  const [dateOnly] = value.split("T");
  const parts = dateOnly.split("-").map(Number);
  const date =
    parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return DETAIL_DATE_FORMATTER.format(date);
}

function formatResultReturn(result: NonNullable<PredictionDetail["result"]>): string {
  return formatReturnPercent(result.returnValue);
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

function predictionShareReturnText(prediction: PredictionDetail, returnText: string): string {
  if (typeof prediction.markReturnValue !== "number") {
    return returnText;
  }

  const elapsedDays = daysSinceCall(prediction.entryDate, prediction.markPriceDate);
  return elapsedDays === null ? returnText : `${returnText} (${elapsedDays}d)`;
}

function predictionShareVersion(prediction: PredictionDetail): string {
  const versionSource = prediction.updatedAt || prediction.createdAt || prediction.id;
  const compactVersion = versionSource.replace(/[^0-9A-Za-z]/g, "");
  return `v3-${compactVersion || prediction.id}`;
}

function predictionUrl(prediction: PredictionDetail): string {
  const origin = typeof window === "undefined" ? "https://youanalyst.com" : window.location.origin;
  const url = new URL(`/predictions/${encodeURIComponent(prediction.id)}`, origin);
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "prediction_share");
  url.searchParams.set("share", predictionShareVersion(prediction));
  return url.toString();
}

function predictionShareText(prediction: PredictionDetail, returnText: string): string {
  const ticker = formatCashtag(prediction.ticker);
  const shareReturn = predictionShareReturnText(prediction, returnText);
  const title = prediction.thesisTitle.trim();

  if (typeof prediction.markReturnValue === "number") {
    return title
      ? `${ticker} is ${shareReturn} on my public YouAnalyst track record.\n\n${title}`
      : `${ticker} is ${shareReturn} on my public YouAnalyst track record.`;
  }

  return title
    ? `Tracking this public ${ticker} call on YouAnalyst.\n\n${title}`
    : `Tracking this public ${ticker} call on YouAnalyst.`;
}

function predictionShareUrl(prediction: PredictionDetail, returnText: string): string {
  return xPostIntentUrl({
    text: predictionShareText(prediction, returnText),
    url: predictionUrl(prediction),
  });
}

export function PredictionDetailPage({ predictionId }: { predictionId: string }) {
  const { getIdToken, user } = useAuth();
  const [prediction, setPrediction] = useState<PredictionDetail | null>(null);
  const [comments, setComments] = useState<PredictionComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<"close" | "cancel" | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [showCloseComposer, setShowCloseComposer] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editThesis, setEditThesis] = useState("");
  const [editHorizonUnit, setEditHorizonUnit] = useState<"NONE" | PredictionTimeHorizonUnit>("NONE");
  const [editHorizonValue, setEditHorizonValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [ownerWatchlists, setOwnerWatchlists] = useState<WatchlistOption[]>([]);
  const [moveWatchlistId, setMoveWatchlistId] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PredictionPriceHistory | null>(null);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function loadAll() {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const headers = token ? { authorization: `Bearer ${token}` } : undefined;
      const [predictionResponse, commentResponse] = await Promise.all([
        fetch(`/api/predictions/${predictionId}`, { headers }),
        fetch(`/api/predictions/${predictionId}/comments?limit=100`, { headers }),
      ]);

      if (!predictionResponse.ok) {
        throw new Error("Prediction not found.");
      }

      const predictionPayload = (await predictionResponse.json()) as PredictionDetail;
      const commentPayload = commentResponse.ok
        ? ((await commentResponse.json()) as { items: PredictionComment[] })
        : { items: [] };

      setPrediction(predictionPayload);
      setComments(commentPayload.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load prediction.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictionId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!prediction || !prediction.entryDate || typeof prediction.entryPrice !== "number") {
      setPriceHistory(null);
      setPriceHistoryLoading(false);
      setPriceHistoryError(null);
      return;
    }

    setPriceHistoryLoading(true);
    setPriceHistoryError(null);

    void getIdToken()
      .then(async (token) => {
        const headers = token ? { authorization: `Bearer ${token}` } : undefined;
        const response = await fetch(`/api/predictions/${prediction.id}/price-history`, { headers });
        if (!response.ok) {
          throw new Error("Unable to load price history.");
        }

        return (await response.json()) as PredictionPriceHistory;
      })
      .then((nextHistory) => {
        if (!cancelled) {
          setPriceHistory(nextHistory);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setPriceHistory(null);
          setPriceHistoryError(nextError instanceof Error ? nextError.message : "Unable to load price history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPriceHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getIdToken, prediction]);

  useEffect(() => {
    if (!user || !prediction || user.uid !== prediction.userId) {
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
        setOwnerWatchlists(payload.items);
        setMoveWatchlistId((current) => current || prediction.watchlistId || payload.items[0]?.id || "");
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load watchlists.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getIdToken, prediction, user]);

  async function submitComment() {
    if (!commentText.trim()) {
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Sign in to add comments.");
      return;
    }

    const response = await fetch(`/api/predictions/${predictionId}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: commentText.trim() }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Unable to add comment.");
      return;
    }

    setCommentText("");
    await loadAll();
  }

  async function runPredictionAction(action: "close" | "cancel") {
    const token = await getIdToken();
    if (!token) {
      setError("Sign in to manage this prediction.");
      return;
    }

    const trimmedCloseReason = closeReason.trim();
    if (action === "close" && !trimmedCloseReason) {
      setError("A close reason is required.");
      return;
    }

    setActionPending(action);
    setError(null);

    try {
      const response = await fetch(`/api/predictions/${predictionId}/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: action === "close" ? JSON.stringify({ reason: trimmedCloseReason }) : undefined,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to update prediction.");
      }

      await loadAll();
      if (action === "close") {
        setCloseReason("");
        setShowCloseComposer(false);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update prediction.");
    } finally {
      setActionPending(null);
    }
  }

  function startEditing() {
    if (!prediction) {
      return;
    }

    setEditTitle(prediction.thesisTitle ?? "");
    setEditThesis(prediction.thesis ?? "");
    setEditHorizonUnit(prediction.timeHorizon?.unit ?? "NONE");
    setEditHorizonValue(prediction.timeHorizon ? String(prediction.timeHorizon.value) : "");
    setEditing(true);
    setError(null);
  }

  async function saveEdits() {
    if (!prediction) {
      return;
    }

    const trimmedTitle = editTitle.trim();
    const trimmedThesis = editThesis.trim();
    const horizonValue = Number(editHorizonValue);
    const validHorizon =
      editHorizonUnit === "NONE" ||
      (Number.isInteger(horizonValue) && horizonValue > 0);

    if (trimmedTitle.length > MAX_PREDICTION_THESIS_TITLE_LENGTH) {
      setError(`Title must be ${MAX_PREDICTION_THESIS_TITLE_LENGTH} characters or fewer.`);
      return;
    }
    if (trimmedThesis.length > MAX_PREDICTION_THESIS_LENGTH) {
      setError(`Thesis must be ${MAX_PREDICTION_THESIS_LENGTH} characters or fewer.`);
      return;
    }
    if (!validHorizon) {
      setError("Open until must be a positive whole number.");
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Sign in to edit this prediction.");
      return;
    }

    setEditSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/predictions/${predictionId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          thesisTitle: trimmedTitle,
          thesis: trimmedThesis,
          timeHorizon: editHorizonUnit === "NONE"
            ? null
            : {
                value: horizonValue,
                unit: editHorizonUnit,
              },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to edit prediction.");
      }

      setEditing(false);
      await loadAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to edit prediction.");
    } finally {
      setEditSaving(false);
    }
  }

  async function movePrediction() {
    if (!prediction || !moveWatchlistId || moveWatchlistId === prediction.watchlistId) {
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setError("Sign in to move this prediction.");
      return;
    }

    setMoveSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/predictions/${predictionId}/watchlist`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ watchlistId: moveWatchlistId }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to move prediction.");
      }

      await loadAll();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to move prediction.");
    } finally {
      setMoveSaving(false);
    }
  }

  if (loading) {
    return <main className="mx-auto w-full max-w-4xl px-4 py-8 text-sm text-slate-300">Loading prediction...</main>;
  }

  if (!prediction) {
    return <main className="mx-auto w-full max-w-4xl px-4 py-8 text-sm text-rose-300">{error ?? "Prediction not found."}</main>;
  }

  const thesis = sanitizePredictionThesis(prediction.thesis);
  const thesisTitle = prediction.thesisTitle.trim();
  const isOwner = Boolean(user && user.uid === prediction.userId);
  const canShareToX = isOwner && prediction.visibility === "PUBLIC";
  const createdAtMs = Date.parse(prediction.createdAt);
  const closeRequestedAtMs = Date.parse(prediction.closeRequestedAt ?? "");
  const createCancelWindowOpen = !Number.isNaN(createdAtMs) && now - createdAtMs <= 5 * 60 * 1000;
  const closeCancelWindowOpen = !Number.isNaN(closeRequestedAtMs) && now - closeRequestedAtMs <= 5 * 60 * 1000;
  const isSettlementPending =
    prediction.status === "OPEN" &&
    Boolean(prediction.closeRequestedAt) &&
    !prediction.result;
  const canEdit =
    isOwner &&
    !isSettlementPending &&
    (prediction.status === "OPEN" || (prediction.status === "CREATED" && !createCancelWindowOpen));
  const returnText =
    typeof prediction.markReturnValue === "number"
      ? formatReturnPercent(prediction.markReturnValue)
      : "Pending";
  const ownerAction =
    isOwner && prediction.status === "CREATED" && createCancelWindowOpen
      ? { action: "cancel" as const, label: "Cancel" }
      : isOwner && prediction.status === "OPEN" && !isSettlementPending
        ? { action: "close" as const, label: "Close" }
        : isOwner && prediction.status === "CLOSING" && closeCancelWindowOpen
          ? { action: "cancel" as const, label: "Cancel close" }
        : null;
  const statusLabel = isSettlementPending ? "Settles at next close" : formatPredictionStatus(prediction.status);
  const xShareUrl = predictionShareUrl(prediction, returnText);
  const movingPublicPredictionToPrivate =
    prediction.visibility === "PUBLIC" &&
    ownerWatchlists.find((watchlist) => watchlist.id === moveWatchlistId)?.isPublic === false;

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold">
            <Link
              href={`/ticker/${prediction.ticker}`}
              className="flex w-fit items-center gap-1 text-cyan-200 hover:text-cyan-100"
              aria-label={`${prediction.direction === "UP" ? "Up" : "Down"} prediction for ${prediction.ticker}`}
            >
              <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
              <span>{formatTickerSymbol(prediction.ticker)}</span>
            </Link>
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg border border-cyan-400/30 px-2.5 py-1 text-xs font-medium text-cyan-100">
              {statusLabel}
            </span>
            {canShareToX ? (
              <a
                href={xShareUrl}
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Share to X
              </a>
            ) : null}
            {ownerAction ? (
              ownerAction.action === "close" ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowCloseComposer((prev) => !prev);
                    setError(null);
                  }}
                  disabled={actionPending !== null}
                  className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {showCloseComposer ? "Cancel close" : ownerAction.label}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void runPredictionAction(ownerAction.action)}
                  disabled={actionPending !== null}
                  className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionPending === ownerAction.action ? "Working..." : ownerAction.label}
                </button>
              )
            ) : null}
            {canEdit && !editing ? (
              <button
                type="button"
                onClick={startEditing}
                className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/15"
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {prediction.status === "CLOSING" ? (
          <div className="mb-4 rounded-xl border border-cyan-400/15 bg-cyan-500/5 px-4 py-3 text-sm text-slate-300">
            <p>Your exit request is locked. Final settlement happens at the next end-of-day update.</p>
            {prediction.closeReason ? (
              <p className="mt-2 text-sm text-slate-200">
                <span className="text-slate-400">Reason: </span>
                {prediction.closeReason}
              </p>
            ) : null}
            {prediction.closeTargetDate ? (
              <p className="mt-1 text-xs text-slate-400">
                Expected settlement: {formatDetailDate(prediction.closeTargetDate)}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-400">
              Next EOD update runs around 9:00 PM ET on trading days.
            </p>
          </div>
        ) : null}

        {showCloseComposer && ownerAction?.action === "close" ? (
          <div className="mb-4 grid gap-3 rounded-xl border border-cyan-400/15 bg-slate-950/45 px-4 py-4">
            <div className="grid gap-1">
              <label className="text-xs text-slate-400" htmlFor="close-reason">
                Close reason
              </label>
              <textarea
                id="close-reason"
                rows={3}
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value)}
                placeholder="Why are you closing this prediction?"
                className="rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
              <p className="text-xs text-slate-500">A reason is required. There is no minimum length.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runPredictionAction("close")}
                disabled={actionPending !== null}
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {actionPending === "close" ? "Working..." : "Confirm close"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCloseComposer(false);
                  setCloseReason("");
                  setError(null);
                }}
                disabled={actionPending !== null}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:border-white/30 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {editing ? (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-xs text-slate-400" htmlFor="edit-thesis-title">Title</label>
              <input
                id="edit-thesis-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                maxLength={MAX_PREDICTION_THESIS_TITLE_LENGTH}
                className="rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400" htmlFor="edit-thesis">Thesis</label>
              <textarea
                id="edit-thesis"
                value={editThesis}
                onChange={(event) => setEditThesis(event.target.value)}
                maxLength={MAX_PREDICTION_THESIS_LENGTH}
                rows={8}
                className="min-h-48 rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
              <p className="text-xs text-slate-400">
                {editThesis.trim().length}/{MAX_PREDICTION_THESIS_LENGTH}
              </p>
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400" htmlFor="edit-horizon-unit">Open until</label>
              <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
                <select
                  id="edit-horizon-unit"
                  value={editHorizonUnit}
                  onChange={(event) => {
                    const nextUnit = event.target.value as "NONE" | PredictionTimeHorizonUnit;
                    setEditHorizonUnit(nextUnit);
                    if (nextUnit === "NONE") {
                      setEditHorizonValue("");
                    }
                  }}
                  className="rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
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
                  value={editHorizonValue}
                  onChange={(event) => setEditHorizonValue(event.target.value)}
                  disabled={editHorizonUnit === "NONE"}
                  placeholder="Value"
                  className="rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring disabled:opacity-50"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveEdits()}
                disabled={editSaving}
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={editSaving}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:border-white/30 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {thesisTitle ? (
              <h2 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-slate-100">
                {formatPredictionThesisTitle(prediction.thesisTitle)}
              </h2>
            ) : null}
            {thesis ? (
              <p className="text-sm text-slate-200">
                <PredictionThesisText text={thesis} />
              </p>
            ) : null}
          </>
        )}
        <div className="mt-4 grid gap-6 text-sm text-slate-300 sm:grid-cols-2">
          <dl className="grid gap-1">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <dt className="text-slate-400">Watchlist:</dt>
              <dd className="text-slate-100">{prediction.watchlistName || "Unassigned"}</dd>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <dt className="text-slate-400">Entry Price:</dt>
              <dd className="text-slate-100">{formatDetailCurrency(prediction.entryPrice)}</dd>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <dt className="text-slate-400">Last Price:</dt>
              <dd className="text-slate-100">{formatDetailCurrency(prediction.markPrice)}</dd>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <dt className="text-slate-400">Return:</dt>
              <dd className={typeof prediction.markReturnValue === "number" ? markToneClass(prediction.markReturnValue) : "text-slate-100"}>
                {returnText}
              </dd>
            </div>
          </dl>

          <dl className="grid gap-1">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <dt className="text-slate-400">Opened:</dt>
              <dd className="text-slate-100">{formatDetailDate(prediction.entryDate)}</dd>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <dt className="text-slate-400">Last Updated:</dt>
              <dd className="text-slate-100">{formatDetailDate(prediction.markPriceDate)}</dd>
            </div>
          </dl>
        </div>

        {isOwner && ownerWatchlists.length > 0 ? (
          <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-slate-950/45 p-3">
            <label className="text-xs text-slate-400" htmlFor="move-watchlist">Move to watchlist</label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <select
                id="move-watchlist"
                value={moveWatchlistId}
                onChange={(event) => setMoveWatchlistId(event.target.value)}
                className="rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              >
                {ownerWatchlists.map((watchlist) => (
                  <option
                    key={watchlist.id}
                    value={watchlist.id}
                    disabled={prediction.visibility === "PUBLIC" && !watchlist.isPublic}
                  >
                    {watchlist.name}
                    {watchlist.isPublic ? "" : prediction.visibility === "PUBLIC" ? " (Private unavailable for public calls)" : " (Private)"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void movePrediction()}
                disabled={moveSaving || !moveWatchlistId || moveWatchlistId === prediction.watchlistId || movingPublicPredictionToPrivate}
                className="rounded-lg border border-cyan-400/35 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
              >
                {moveSaving ? "Moving..." : "Move"}
              </button>
            </div>
            {movingPublicPredictionToPrivate ? (
              <p className="text-xs text-slate-400">
                Public predictions stay public. Close this prediction if you no longer want to continue it publicly.
              </p>
            ) : ownerWatchlists.find((watchlist) => watchlist.id === moveWatchlistId)?.isPublic === false ? (
              <p className="text-xs text-amber-200">
                Moving this prediction into a private watchlist will make the prediction private too.
              </p>
            ) : null}
          </div>
        ) : null}

        {!isOwner ? <PredictionAuthorSummary author={prediction} className="mt-5" /> : null}

        {prediction.result ? (
          <div className="mt-4 rounded-xl border border-emerald-400/35 bg-emerald-900/20 p-3 text-sm text-emerald-50">
            Closed at {prediction.result.exitPrice.toFixed(2)} with return {formatResultReturn(prediction.result)}.
            {prediction.closeReason ? (
              <p className="mt-2 text-sm text-emerald-100">
                <span className="text-emerald-200/80">Close reason: </span>
                {prediction.closeReason}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <PredictionPriceChart history={priceHistory} loading={priceHistoryLoading} error={priceHistoryError} />

      <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <h2 className="mb-3 font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Discussion</h2>

        <div className="mb-4 grid gap-2">
          {comments.map((comment) => (
            <article key={comment.id} className="rounded-xl border border-white/10 p-3">
              <p className="text-sm text-slate-100">{comment.content}</p>
              <p className="mt-2 text-xs text-slate-400">
                {comment.authorNickname ? `@${comment.authorNickname}` : comment.authorDisplayName ?? "Anonymous"} / <RelativeTime value={comment.createdAt} />
              </p>
            </article>
          ))}

          {comments.length === 0 ? <p className="text-sm text-slate-300">No comments yet.</p> : null}
        </div>

        {user ? (
          <div className="grid gap-2">
            <textarea
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              rows={3}
              placeholder="Add a thoughtful comment"
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
            <button
              type="button"
              onClick={() => void submitComment()}
              className="w-full rounded-full border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 sm:w-fit"
            >
              Post comment
            </button>
          </div>
        ) : (
          <Link
            href="/auth"
            className="inline-block rounded-full border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15"
          >
            Sign in to join the discussion
          </Link>
        )}

        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </section>
    </main>
  );
}
