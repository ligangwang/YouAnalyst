"use client";

import { UiText } from "@/components/ui-text";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from './providers/locale-provider';

type OpenAiUsageSummary = {
  eventCount: number;
  unknownCostCount?: number;
  estimatedCostUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type OpenAiUsageEvent = {
  id: string;
  purpose: "ai_analyst_generation" | "company_graph_extraction" | "industry_research" | "earnings_calendar_extraction" | "news_headline_translation";
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
  calendarLast30Days?: OpenAiUsageSummary;
  calendarThisQuarter?: OpenAiUsageSummary;
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
  return {company_graph_extraction:'Company graph',ai_analyst_generation:'AI analyst',industry_research:'Industry research',earnings_calendar_extraction:'Earnings calendar',news_headline_translation:'News headline translation'}[value];
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
  const {text:t}=useLocale();
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
      <p className="text-xs uppercase text-slate-500"><UiText text={label} /></p>
      <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
        {summary ? formatCost(summary.estimatedCostUsd) : "-"}
      </p>
      {summary?.unknownCostCount ? <p className="mt-1 text-xs text-amber-200">{summary.unknownCostCount} {t('calls have unknown cost; excluded from this estimate.','次调用费用未知，未计入估算。')}</p> : null}
      <p className="mt-2 text-xs text-slate-400">
        {summary ? <UiText text={`${formatCount(summary.eventCount)} calls - ${formatCount(summary.totalTokens)} tokens`} /> : <UiText text={"Loading"} />}
      </p>
    </div>
  );
}

export function AdminOpenAiUsagePage() {
  const {text:t}=useLocale();
  const { user, loading, getIdToken } = useAuth();
  const [events, setEvents] = useState<OpenAiUsageEvent[]>([]);
  const [summary, setSummary] = useState<OpenAiUsageSummary | null>(null);
  const [last30Days, setLast30Days] = useState<OpenAiUsageSummary | null>(null);
  const [calendar30,setCalendar30] = useState<OpenAiUsageSummary|null>(null);
  const [calendarQuarter,setCalendarQuarter] = useState<OpenAiUsageSummary|null>(null);
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
      setCalendar30(payload.calendarLast30Days ?? null);
      setCalendarQuarter(payload.calendarThisQuarter ?? null);
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
      <p className="mb-3 text-sm font-medium text-cyan-200"><UiText text={"Admin"} /></p>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"OpenAI usage"} /></h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"Review token usage and estimated USD cost for recent OpenAI calls."} /></p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsage()}
          disabled={loadingUsage}
          className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loadingUsage ? <UiText text={"Refreshing..."} /> : <UiText text={"Refresh"} />}
        </button>
      </div>

      {error ? <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{<UiText text={error} />}</p> : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Recent loaded calls" summary={summary} />
        <SummaryCard label="All calls · last 30 days" summary={last30Days} />
        <SummaryCard label="Calendar · last 30 days" summary={calendar30} />
        <SummaryCard label="Calendar · this quarter (UTC)" summary={calendarQuarter} />
      </section>
      <p className="mb-4 text-xs text-slate-400">{t('Costs are estimates from returned token usage and configured model rates. Calendar totals cover all recorded calls in the period. Reused extraction results do not make another API call.','费用按返回的 token 用量及模型费率估算。日历总额覆盖该时段所有已记录调用，复用结果不会再次调用 API。')}</p>

      <section className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase text-slate-500">
          <span><UiText text={"Call"} /></span>
          <span><UiText text={"Model"} /></span>
          <span><UiText text={"Tokens"} /></span>
          <span><UiText text={"Cost"} /></span>
          <span><UiText text={"Pricing"} /></span>
        </div>

        {events.map((event) => (
          <article
            key={event.id}
            className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 md:grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_0.8fr]"
          >
            <div>
              <p className="font-semibold text-cyan-100">{<UiText text={purposeLabel(event.purpose)} />} - {metadataLabel(event)}</p>
              <p className="mt-1 text-xs text-slate-400">{formatDate(event.createdAt)}</p>
              {event.purpose === 'earnings_calendar_extraction' ? <p className="mt-1 text-xs text-slate-400">{String(event.metadata.validationStatus ?? event.metadata.status ?? '')}</p> : null}
              {event.purpose === 'earnings_calendar_extraction' && event.metadata.validationError ? <p className="mt-1 text-xs text-amber-200">{String(event.metadata.validationError)}</p> : null}
              {event.responseId ? <p className="mt-1 break-all text-xs text-slate-500">{event.responseId}</p> : null}
            </div>
            <p className="text-slate-200">{event.model}</p>
            <div className="text-slate-300">
              <p>{formatCount(event.totalTokens)}<UiText text={" total"} /></p>
              <p className="mt-1 text-xs text-slate-500">
                {formatCount(event.inputTokens)}<UiText text={" in - "} />{formatCount(event.cachedInputTokens)}<UiText text={" cached - "} />{formatCount(event.outputTokens)}<UiText text={" out"} /></p>
            </div>
            <p className="font-semibold text-cyan-100">{formatCost(event.estimatedCostUsd)}</p>
            <p className="text-xs text-slate-400">
              {event.pricing.source === "unknown"
                ? <UiText text={"No rate configured"} />
                : <UiText text={`${event.pricing.source === "env" ? "Env" : "Built-in"} rates`} />}
            </p>
          </article>
        ))}

        {!loadingUsage && events.length === 0 ? (
          <p className="p-6 text-sm text-slate-300"><UiText text={"No OpenAI usage events have been recorded yet."} /></p>
        ) : null}
      </section>
    </main>
  );
}
