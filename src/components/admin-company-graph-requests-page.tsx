"use client";

import { UiText } from "@/components/ui-text";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type GraphRequestStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

type GraphRequestItem = {
  id: string;
  ticker: string;
  status: GraphRequestStatus;
  requestedCount: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  error: string | null;
};

type RequestsResponse = {
  items?: GraphRequestItem[];
  error?: string;
};

type ExtractResponse = {
  ok?: boolean;
  error?: string;
  status?: "QUEUED" | "ALREADY_QUEUED" | "AVAILABLE";
  dispatch?: { status: "PUBLISHED" | "PENDING" };
  // Transitional deployments without a queue topic still return a direct result.
  edges?: unknown[];
  cached?: boolean;
  extraction?: { usageEvent?: { estimatedCostUsd?: number | null } | null } | null;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCost(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "unknown cost";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function statusClassName(status: GraphRequestStatus): string {
  if (status === "COMPLETED") {
    return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  }
  if (status === "FAILED") {
    return "border-rose-400/40 bg-rose-500/10 text-rose-100";
  }
  if (status === "PROCESSING") {
    return "border-cyan-400/40 bg-cyan-500/10 text-cyan-100";
  }
  return "border-amber-400/35 bg-amber-500/10 text-amber-100";
}

export function AdminCompanyGraphRequestsPage() {
  const { user, loading, getIdToken } = useAuth();
  const [items, setItems] = useState<GraphRequestItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const submitting = useRef(false);
  const [acceptedTickers, setAcceptedTickers] = useState<Set<string>>(new Set());
  const [unconfirmedTickers, setUnconfirmedTickers] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [freshTicker, setFreshTicker] = useState<string | null>(null);

  async function loadRequests(confirmHistory = false) {
    setFreshTicker(null);
    setLoadingQueue(true);
    setQueueError(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to view graph requests.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to view graph requests.");
      }

      const response = await fetch("/api/admin/company-graph/requests", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as RequestsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load company graph requests.");
      }
      if (!Array.isArray(payload.items)) {
        throw new Error("Unable to read company graph request history. Refresh to try again.");
      }

      setItems(payload.items);
      const activeRequests = new Set(payload.items.filter((item) => item.status === "QUEUED" || item.status === "PROCESSING").map((item) => item.ticker));
      setAcceptedTickers((current) => new Set([...current].filter((ticker) => activeRequests.has(ticker))));
      if (confirmHistory) {
        setUnconfirmedTickers(new Set());
        setError(null);
      }
    } catch (nextError) {
      setQueueError(nextError instanceof Error ? nextError.message : "Unable to load company graph requests.");
    } finally {
      setLoadingQueue(false);
    }
  }

  useEffect(() => {
    if (loading) {
      return;
    }

    void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  async function queueGraph(item: GraphRequestItem, forceNew = false) {
    if (submitting.current || loadingQueue || unconfirmedTickers.has(item.ticker) || acceptedTickers.has(item.ticker) || item.status === "PROCESSING") {
      return;
    }

    submitting.current = true;
    const shouldForce = forceNew || item.status === "COMPLETED";
    setFreshTicker(null);
    const ticker = item.ticker;
    let requestStarted = false;
    let requestRejected = false;
    setActiveTicker(ticker);
    setError(null);
    setMessage(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to queue graph extraction.");
      }

      const token = await getIdToken(true);
      if (!token) {
        throw new Error("Sign in with an admin account to queue graph extraction.");
      }

      requestStarted = true;
      const response = await fetch("/api/admin/company-graph/extract", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticker,
          force: shouldForce,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ExtractResponse;

      if (!response.ok) {
        // A timeout or server failure may happen after the durable write.
        requestRejected = response.status >= 400 && response.status < 500 && response.status !== 408;
        throw new Error(payload.error ?? "Unable to queue company graph extraction.");
      }
      const queued = payload.status === "QUEUED" || payload.status === "ALREADY_QUEUED";
      const directResult = !payload.status && Array.isArray(payload.edges);
      if (!payload.ok || (!queued && payload.status !== "AVAILABLE" && !directResult)) {
        throw new Error("Unable to confirm the graph extraction request.");
      }

      if (queued) {
        setAcceptedTickers((current) => new Set(current).add(ticker));
      }
      // Keep the accepted state visible even if the history refresh fails.
      setItems((current) => current.map((entry) => entry.ticker !== ticker ? entry : {
        ...entry,
        status: !queued ? "COMPLETED" : entry.status === "PROCESSING" ? "PROCESSING" : "QUEUED",
        error: null,
      }));
      const acceptedMessage = directResult
        ? payload.cached
          ? `${ticker} graph is already current.`
          : `${ticker} graph ${shouldForce ? "regenerated" : "generated"} with ${payload.edges!.length} edges. Estimated OpenAI cost: ${formatCost(payload.extraction?.usageEvent?.estimatedCostUsd)}.`
        : payload.status === "AVAILABLE"
          ? `${ticker} graph is already available.`
          : payload.status === "ALREADY_QUEUED"
            ? `${ticker} graph extraction is already queued or processing. Refresh request history for results.`
            : `${ticker} graph ${shouldForce ? "regeneration" : "extraction"} queued. Processing continues in the background. Refresh request history for results.`;
      setMessage(queued && payload.dispatch?.status === "PENDING"
        ? `${acceptedMessage} The request is saved; worker dispatch is pending.`
        : acceptedMessage);
      await loadRequests();
    } catch (nextError) {
      if (requestStarted && !requestRejected) {
        setUnconfirmedTickers((current) => new Set(current).add(ticker));
        setError(`${ticker} request could not be confirmed. A durable request may already exist. Refresh request history before submitting again.`);
      } else {
        setError(nextError instanceof Error ? nextError.message : "Unable to queue company graph extraction.");
      }
      await loadRequests();
    } finally {
      submitting.current = false;
      setActiveTicker(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="mb-3 text-sm font-medium text-cyan-200"><UiText text={"Admin"} /></p>
      <Link href="/admin/industry-research" className="mb-4 inline-block text-cyan-200 underline"><UiText text={"Industry research"} /></Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"Company graph requests"} /></h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"Submit supply-chain and competitor graph requests. Background extraction continues after acceptance; refresh request history for progress."} /></p>
        </div>
        <button
          type="button"
          onClick={() => void loadRequests(true)}
          disabled={loadingQueue || activeTicker !== null}
          className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loadingQueue ? <UiText text={"Refreshing..."} /> : <UiText text={"Refresh"} />}
        </button>
      </div>

      {message ? <p role="status" className="mb-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{<UiText text={message} />}</p> : null}
      {error ? <p role="alert" className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{<UiText text={error} />}</p> : null}
      {queueError ? <p role="alert" className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{<UiText text={queueError} />}</p> : null}

      <section className="grid gap-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-2xl border border-white/15 bg-slate-950/55 p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">${item.ticker}</h2>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(item.status)}`}>
                    {<UiText text={item.status} />}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300"><UiText text={"Requested "} />{item.requestedCount}<UiText text={" time"} />{item.requestedCount === 1 ? "" : <UiText text={"s"} />}<UiText text={" - last requested "} />{formatDate(item.lastRequestedAt)}
                </p>
                {item.error ? <p className="mt-2 text-sm text-rose-200">{<UiText text={item.error} />}</p> : null}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row lg:items-center">
                <Link
                  href={`/ticker/${encodeURIComponent(item.ticker)}`}
                  className="rounded-lg border border-white/15 px-4 py-2 text-center text-sm font-semibold text-slate-100 hover:border-cyan-300/60"
                ><UiText text={"View ticker"} /></Link>
                <button
                  type="button"
                  onClick={() => void queueGraph(item)}
                  disabled={activeTicker !== null || loadingQueue || unconfirmedTickers.has(item.ticker) || acceptedTickers.has(item.ticker) || item.status === "PROCESSING"}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeTicker === item.ticker ? <UiText text={"Submitting..."} />
                    : unconfirmedTickers.has(item.ticker) ? <UiText text={"Refresh to verify"} />
                      : acceptedTickers.has(item.ticker) && item.status === "QUEUED" ? <UiText text={"Queued"} />
                        : item.status === "PROCESSING" ? <UiText text={"Processing"} />
                          : item.status === "COMPLETED" ? <UiText text={"Queue regeneration"} />
                            : item.status === "FAILED" ? <UiText text={"Queue retry"} />
                              : <UiText text={"Queue extraction"} />}
                </button>
                {item.status === "FAILED" ? (
                  <button type="button" onClick={() => setFreshTicker(item.ticker)}
                    disabled={activeTicker !== null || loadingQueue || unconfirmedTickers.has(item.ticker) || acceptedTickers.has(item.ticker)}
                    className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-60">
                    <UiText text={"Start fresh extraction"} />
                  </button>
                ) : null}
              </div>
            </div>
            {freshTicker === item.ticker && item.status === "FAILED" ? (
              <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
                <p className="mb-3 text-sm text-amber-100"><UiText text={"Start a new extraction after reviewing this failure? This bypasses the failed provider response and may incur another OpenAI charge."} /></p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void queueGraph(item, true)} disabled={activeTicker !== null || loadingQueue}
                    className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                    <UiText text={"Confirm fresh extraction"} />
                  </button>
                  <button type="button" onClick={() => setFreshTicker(null)} disabled={activeTicker !== null}
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm"><UiText text={"Cancel"} /></button>
                </div>
              </div>
            ) : null}
          </article>
        ))}

        {!loadingQueue && items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300"><UiText text={"No company graph requests yet."} /></p>
        ) : null}
      </section>
    </main>
  );
}
