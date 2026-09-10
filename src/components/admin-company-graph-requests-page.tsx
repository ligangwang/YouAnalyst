"use client";

import { UiText } from "@/components/ui-text";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRequests() {
    setLoadingQueue(true);
    setError(null);

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

      setItems(payload.items ?? []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load company graph requests.");
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

  async function generateGraph(item: GraphRequestItem) {
    const shouldForce = item.status === "COMPLETED";
    const ticker = item.ticker;
    setActiveTicker(ticker);
    setError(null);
    setMessage(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to generate graph data.");
      }

      const token = await getIdToken(true);
      if (!token) {
        throw new Error("Sign in with an admin account to generate graph data.");
      }

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
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        edges?: unknown[];
        cached?: boolean;
        extraction?: {
          usageEvent?: {
            estimatedCostUsd?: number | null;
          } | null;
        } | null;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to generate company graph.");
      }

      setMessage(payload.cached
        ? `${ticker} graph is already current.`
        : `${ticker} graph ${shouldForce ? "regenerated" : "generated"} with ${payload.edges?.length ?? 0} edges. Estimated OpenAI cost: ${formatCost(payload.extraction?.usageEvent?.estimatedCostUsd)}.`);
      await loadRequests();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to generate company graph.");
      await loadRequests();
    } finally {
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
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"Generate queued supply-chain and competitor graphs one ticker at a time."} /></p>
        </div>
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={loadingQueue}
          className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loadingQueue ? <UiText text={"Refreshing..."} /> : <UiText text={"Refresh"} />}
        </button>
      </div>

      {message ? <p className="mb-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">{<UiText text={message} />}</p> : null}
      {error ? <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{<UiText text={error} />}</p> : null}

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
                  onClick={() => void generateGraph(item)}
                  disabled={activeTicker === item.ticker || item.status === "PROCESSING"}
                  className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeTicker === item.ticker ? <UiText text={"Generating..."} /> : item.status === "COMPLETED" ? <UiText text={"Regenerate"} /> : <UiText text={"Generate"} />}
                </button>
              </div>
            </div>
          </article>
        ))}

        {!loadingQueue && items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300"><UiText text={"No company graph requests yet."} /></p>
        ) : null}
      </section>
    </main>
  );
}
