"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type {
  InstitutionalDiscoveryManager,
  InstitutionalDiscoverySummary,
  InstitutionalDiscoveryTickerActivity,
} from "@/lib/securities/institutional-data";

type ActivitySort = "gross" | "net-buying" | "net-selling" | "managers";

type DiscoveryResponse = InstitutionalDiscoverySummary & {
  error?: string;
};

const INITIAL_ACTIVITY_COUNT = 12;
const INITIAL_MANAGER_COUNT = 18;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Unknown";
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

function formatDate(value: string | null): string {
  return value || "Unknown";
}

function changeTone(status: string): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function activityMatches(activity: InstitutionalDiscoveryTickerActivity, tickerFilter: string): boolean {
  const filter = normalizeSearch(tickerFilter).replace(/^\$/, "");
  if (!filter) {
    return true;
  }

  return activity.ticker.toLowerCase().includes(filter) || activity.nameOfIssuer.toLowerCase().includes(filter);
}

function managerMatches(manager: InstitutionalDiscoveryManager, managerFilter: string): boolean {
  const filter = normalizeSearch(managerFilter);
  if (!filter) {
    return true;
  }
  const cikFilter = filter.replace(/\D/g, "");

  return manager.name.toLowerCase().includes(filter) || (cikFilter.length > 0 && manager.cik.includes(cikFilter));
}

function sortActivities(items: InstitutionalDiscoveryTickerActivity[], sort: ActivitySort): InstitutionalDiscoveryTickerActivity[] {
  return [...items].sort((left, right) => {
    if (sort === "net-buying") {
      return right.netValueChangeUsd - left.netValueChangeUsd;
    }
    if (sort === "net-selling") {
      return left.netValueChangeUsd - right.netValueChangeUsd;
    }
    if (sort === "managers") {
      return right.managerCount - left.managerCount || right.grossValueChangeUsd - left.grossValueChangeUsd;
    }
    return right.grossValueChangeUsd - left.grossValueChangeUsd;
  });
}

export function InstitutionsDiscoveryPage({ initialSummary }: { initialSummary: InstitutionalDiscoverySummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [activityFilter, setActivityFilter] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [activitySort, setActivitySort] = useState<ActivitySort>("gross");
  const [activityVisible, setActivityVisible] = useState(INITIAL_ACTIVITY_COUNT);
  const [managerVisible, setManagerVisible] = useState(INITIAL_MANAGER_COUNT);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredActivities = useMemo(() => (
    sortActivities(summary.activeTickers.filter((activity) => activityMatches(activity, activityFilter)), activitySort)
  ), [activityFilter, activitySort, summary.activeTickers]);
  const filteredManagers = useMemo(() => (
    summary.managers.filter((manager) => managerMatches(manager, managerFilter))
  ), [managerFilter, summary.managers]);

  async function refreshDiscovery() {
    setError(null);
    startTransition(async () => {
      try {
        const params = new URLSearchParams({
          managerLimit: "150",
          activityLimit: "1200",
          tickerLimit: "150",
        });
        const response = await fetch(`/api/institutions/discovery?${params.toString()}`);
        const payload = (await response.json().catch(() => ({}))) as DiscoveryResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to refresh institutional discovery.");
        }

        setSummary(payload);
        setActivityVisible(INITIAL_ACTIVITY_COUNT);
        setManagerVisible(INITIAL_MANAGER_COUNT);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to refresh institutional discovery.");
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Institutional activity</p>
            <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">
              Browse 13F institutions
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Recent manager filings and ticker-level activity from the tracked 13F pipeline.
            </p>
            <p className="mt-3 text-xs text-slate-500">Updated {formatDateTime(summary.generatedAt)}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshDiscovery()}
            disabled={isPending}
            className="w-fit rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
          >
            {isPending ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error ? <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}
      </section>

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_10rem] lg:items-end">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent ticker activity</h2>
            <p className="mt-1 text-sm text-slate-400">
              Tickers with the largest reported value changes in recent parsed filings.
            </p>
          </div>
          <label className="grid gap-1 text-xs text-slate-400">
            Ticker filter
            <input
              type="text"
              value={activityFilter}
              onChange={(event) => {
                setActivityFilter(event.target.value);
                setActivityVisible(INITIAL_ACTIVITY_COUNT);
              }}
              placeholder="AAPL or Apple"
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            Sort
            <select
              value={activitySort}
              onChange={(event) => setActivitySort(event.target.value as ActivitySort)}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            >
              <option value="gross">Gross activity</option>
              <option value="net-buying">Net buying</option>
              <option value="net-selling">Net selling</option>
              <option value="managers">Manager count</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {filteredActivities.slice(0, activityVisible).map((activity) => (
            <article key={`${activity.ticker}_${activity.reportDate}`} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Link href={`/ticker/${activity.ticker}`} className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100 hover:text-cyan-300">
                    {activity.ticker}
                  </Link>
                  <p className="mt-1 text-sm text-slate-400">{activity.nameOfIssuer}</p>
                </div>
                <p className="text-right text-sm font-semibold tabular-nums text-slate-100">{formatSignedCurrency(activity.netValueChangeUsd)}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <p className="text-slate-400">Managers<span className="mt-1 block font-semibold text-slate-100">{activity.managerCount}</span></p>
                <p className="text-emerald-200">Added<span className="mt-1 block font-semibold">{activity.newManagers + activity.increasedManagers}</span></p>
                <p className="text-rose-200">Trimmed<span className="mt-1 block font-semibold">{activity.reducedManagers + activity.soldOutManagers}</span></p>
                <p className="text-slate-400">Report<span className="mt-1 block font-semibold text-slate-100">{formatDate(activity.reportDate)}</span></p>
              </div>

              <div className="mt-4 grid gap-2">
                {activity.topManagers.map((manager) => (
                  <div key={`${activity.ticker}_${manager.managerCik}_${manager.status}`} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-slate-950/55 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/institutions/${manager.managerCik}`} className="font-semibold text-slate-100 hover:text-cyan-200">
                      {manager.managerName}
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(manager.status)}`}>{manager.status}</span>
                      <span className="text-sm tabular-nums text-slate-300">{formatSignedCurrency(manager.valueChangeUsd)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        {filteredActivities.length === 0 ? <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">No matching institutional ticker activity is available.</p> : null}
        {activityVisible < filteredActivities.length ? (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setActivityVisible((value) => value + 12)} className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15">
              Load more activity
            </button>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recently updated institutions</h2>
            <p className="mt-1 text-sm text-slate-400">Managers with recent parsed 13F filings.</p>
          </div>
          <label className="grid gap-1 text-xs text-slate-400">
            Institution filter
            <input
              type="text"
              value={managerFilter}
              onChange={(event) => {
                setManagerFilter(event.target.value);
                setManagerVisible(INITIAL_MANAGER_COUNT);
              }}
              placeholder="Berkshire or CIK"
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredManagers.slice(0, managerVisible).map((manager) => (
            <Link key={manager.cik} href={`/institutions/${manager.cik}`} className="rounded-xl border border-white/10 bg-slate-900/60 p-4 transition hover:border-cyan-300/60 hover:bg-slate-900">
              <p className="font-semibold text-cyan-100">{manager.name}</p>
              <p className="mt-1 text-xs text-slate-500">CIK {manager.cik}</p>
              <div className="mt-4 grid gap-1 text-sm text-slate-300">
                <p>Quarter {manager.latestQuarter ?? "Unknown"}</p>
                <p>Report {formatDate(manager.latestReportDate)}</p>
                <p className="truncate text-xs text-slate-500">Filing {manager.latestAccessionNumber ?? "Unknown"}</p>
              </div>
            </Link>
          ))}
        </div>

        {filteredManagers.length === 0 ? <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">No matching institutions found.</p> : null}
        {managerVisible < filteredManagers.length ? (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setManagerVisible((value) => value + 18)} className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15">
              Load more institutions
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
