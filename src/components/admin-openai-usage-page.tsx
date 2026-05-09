"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type OpenAiUsageSummary = {
  eventCount: number;
  estimatedCostUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type OpenAiUsageEvent = {
  id: string;
  purpose: "ai_analyst_generation" | "company_graph_extraction";
  model: string;
  responseId: string | null;
  createdAt: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  pricing: {
    source: "env" | "built_in" | "unknown";
    input: number | null;
    cachedInput: number | null;
    output: number | null;
  };
  metadata: Record<string, string | number | boolean | null>;
};

type UsageResponse = {
  events?: OpenAiUsageEvent[];
  summary?: OpenAiUsageSummary;
  last30Days?: OpenAiUsageSummary;
  error?: string;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatCost(value: number | null): string {
  if (value === null) {
    return "Unknown";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function purposeLabel(value: OpenAiUsageEvent["purpose"]): string {
  return value === "company_graph_extraction" ? "Company graph" : "AI analyst";
}

function metadataLabel(event: OpenAiUsageEvent): string {
  const ticker = event.metadata.ticker;
  const runDate = event.metadata.runDate;
  if (typeof ticker === "string" && ticker) {
    return ticker;
  }
  if (typeof runDate === "string" && runDate) {
    return runDate;
  }

  return event.responseId ?? event.id;
}

function SummaryCard({ label, summary }: { label: string; summary: OpenAiUsageSummary | null }) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
        {summary ? formatCost(summary.estimatedCostUsd) : "-"}
      </p>
      <p className="mt-2 text-xs text-slate-400">
        {summary ? `${formatCount(summary.eventCount)} calls - ${formatCount(summary.totalTokens)} tokens` : "Loading"}
      </p>
    </div>
  );
}

export function AdminOpenAiUsagePage() {
  const { user, loading, getIdToken } = useAuth();
  const [events, setEvents] = useState<OpenAiUsageEvent[]>([]);
  const [summary, setSummary] = useState<OpenAiUsageSummary | null>(null);
  const [last30Days, setLast30Days] = useState<OpenAiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  async function loadUsage() {
    setLoadingUsage(true);
    setError(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to view OpenAI usage.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to view OpenAI usage.");
      }

      const response = await fetch("/api/admin/openai-usage?limit=200", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as UsageResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load OpenAI usage.");
      }

      setEvents(payload.events ?? []);
      setSummary(payload.summary ?? null);
      setLast30Days(payload.last30Days ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load OpenAI usage.");
    } finally {
      setLoadingUsage(false);
    }
  }

  useEffect(() => {
    if (loading) {
      return;
    }

    void loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="mb-3 text-sm font-medium text-cyan-200">Admin</p>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">OpenAI usage</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Review token usage and estimated USD cost for recent OpenAI calls.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsage()}
          disabled={loadingUsage}
          className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loadingUsage ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Recent loaded calls" summary={summary} />
        <SummaryCard label="Last 30 days loaded" summary={last30Days} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase text-slate-500">
          <span>Call</span>
          <span>Model</span>
          <span>Tokens</span>
          <span>Cost</span>
          <span>Pricing</span>
        </div>

        {events.map((event) => (
          <article
            key={event.id}
            className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 md:grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_0.8fr]"
          >
            <div>
              <p className="font-semibold text-cyan-100">{purposeLabel(event.purpose)} - {metadataLabel(event)}</p>
              <p className="mt-1 text-xs text-slate-400">{formatDate(event.createdAt)}</p>
              {event.responseId ? <p className="mt-1 break-all text-xs text-slate-500">{event.responseId}</p> : null}
            </div>
            <p className="text-slate-200">{event.model}</p>
            <div className="text-slate-300">
              <p>{formatCount(event.totalTokens)} total</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatCount(event.inputTokens)} in - {formatCount(event.cachedInputTokens)} cached - {formatCount(event.outputTokens)} out
              </p>
            </div>
            <p className="font-semibold text-cyan-100">{formatCost(event.estimatedCostUsd)}</p>
            <p className="text-xs text-slate-400">
              {event.pricing.source === "unknown"
                ? "No rate configured"
                : `${event.pricing.source === "env" ? "Env" : "Built-in"} rates`}
            </p>
          </article>
        ))}

        {!loadingUsage && events.length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No OpenAI usage events have been recorded yet.</p>
        ) : null}
      </section>
    </main>
  );
}
