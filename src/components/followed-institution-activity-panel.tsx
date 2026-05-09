"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { FollowedInstitutionActivity } from "@/lib/securities/institution-follows";

type ActivitySort = "newest" | "largest" | "buying" | "selling";
type ActivityStatusFilter = "ALL" | FollowedInstitutionActivity["status"];

type ActivityResponse = {
  items?: FollowedInstitutionActivity[];
  error?: string;
};

const STATUS_FILTERS: ActivityStatusFilter[] = ["ALL", "NEW", "INCREASED", "REDUCED", "SOLD_OUT", "UNCHANGED"];

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "new";
  }

  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(value)}`;
}

function changeTone(status: FollowedInstitutionActivity["status"]): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

function filingUrl(managerCik: string, accessionNumber: string): string {
  const cik = String(Number(managerCik));
  const accessionPath = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${accessionNumber}-index.html`;
}

function activityMatches(activity: FollowedInstitutionActivity, query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/^\$/, "");
  if (!normalized) {
    return true;
  }
  const cikFilter = normalized.replace(/\D/g, "");

  return (
    activity.managerName.toLowerCase().includes(normalized) ||
    (cikFilter.length > 0 && activity.managerCik.includes(cikFilter)) ||
    activity.nameOfIssuer.toLowerCase().includes(normalized) ||
    activity.ticker?.toLowerCase().includes(normalized)
  ) === true;
}

function sortActivity(items: FollowedInstitutionActivity[], sort: ActivitySort): FollowedInstitutionActivity[] {
  return [...items].sort((left, right) => {
    if (sort === "largest") {
      return Math.abs(right.valueChangeUsd) - Math.abs(left.valueChangeUsd);
    }
    if (sort === "buying") {
      return right.valueChangeUsd - left.valueChangeUsd;
    }
    if (sort === "selling") {
      return left.valueChangeUsd - right.valueChangeUsd;
    }

    return (
      right.reportDate.localeCompare(left.reportDate) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      Math.abs(right.valueChangeUsd) - Math.abs(left.valueChangeUsd)
    );
  });
}

export function FollowedInstitutionActivityPanel() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<FollowedInstitutionActivity[]>([]);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>("ALL");
  const [sort, setSort] = useState<ActivitySort>("newest");
  const [refreshing, setRefreshing] = useState(false);
  const requestIdRef = useRef(0);
  const filteredItems = useMemo(() => (
    sortActivity(
      items.filter((activity) => (
        activityMatches(activity, query) &&
        (statusFilter === "ALL" || activity.status === statusFilter)
      )),
      sort,
    )
  ), [items, query, sort, statusFilter]);

  const loadActivity = useCallback(async (nextUserId: string) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRefreshing(true);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in to load followed activity.");
      }

      const response = await fetch("/api/institutions/follows/activity?limit=100", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as ActivityResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load followed activity.");
      }

      if (requestIdRef.current === requestId) {
        setItems(payload.items ?? []);
        setLoadedForUser(nextUserId);
      }
    } catch (nextError) {
      if (requestIdRef.current === requestId) {
        setError(nextError instanceof Error ? nextError.message : "Unable to load followed activity.");
        setLoadedForUser(nextUserId);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setRefreshing(false);
      }
    }
  }, [getIdToken]);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    void loadActivity(user.uid);
  }, [authLoading, loadActivity, user]);

  if (authLoading || !user) {
    return null;
  }

  const loading = loadedForUser !== user.uid;

  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Followed institution activity</h2>
          <p className="mt-1 text-sm text-slate-400">Recent reported position changes from managers you follow.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadActivity(user.uid)}
          disabled={refreshing}
          className="w-fit rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {loading ? <p className="text-sm text-slate-300">Loading followed institution activity...</p> : null}

      {!loading && items.length > 0 ? (
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-end">
          <label className="grid gap-1 text-xs text-slate-400">
            Activity search
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ticker, issuer, or institution"
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as ActivitySort)}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            >
              <option value="newest">Newest</option>
              <option value="largest">Largest change</option>
              <option value="buying">Buying</option>
              <option value="selling">Selling</option>
            </select>
          </label>
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                statusFilter === status ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300 hover:border-cyan-300/60"
              }`}
            >
              {status === "ALL" ? "All" : status.replace("_", " ")}
            </button>
          ))}
        </div>
      ) : null}

      {!loading && filteredItems.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredItems.map((activity) => (
            <article
              key={activity.positionKey}
              className="rounded-xl border border-white/10 bg-slate-900/60 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Link href={`/institutions/${activity.managerCik}`} className="font-semibold text-slate-100 hover:text-cyan-200">
                    {activity.managerName}
                  </Link>
                  <p className="mt-2 text-sm text-slate-300">
                    {activity.ticker ? (
                      <Link href={`/ticker/${activity.ticker}`} className="font-semibold text-cyan-100 hover:text-cyan-300">
                        {activity.ticker}
                      </Link>
                    ) : (
                      <span className="font-semibold text-slate-100">Unmapped</span>
                    )}{" "}
                    <span className="text-slate-400">{activity.nameOfIssuer}</span>
                  </p>
                </div>
                <span className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(activity.status)}`}>
                  {activity.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <p className="text-slate-400">
                  Value
                  <span className="mt-1 block font-semibold tabular-nums text-slate-100">{formatSignedCurrency(activity.valueChangeUsd)}</span>
                </p>
                <p className="text-slate-400">
                  Shares
                  <span className="mt-1 block font-semibold tabular-nums text-slate-100">{formatNumber(activity.shareChange)}</span>
                </p>
                <p className="text-slate-400">
                  Change
                  <span className="mt-1 block font-semibold tabular-nums text-slate-100">{formatPercent(activity.percentChange)}</span>
                </p>
                <p className="text-slate-400">
                  Report
                  <span className="mt-1 block font-semibold text-slate-100">{activity.reportDate}</span>
                </p>
              </div>

              <a
                href={filingUrl(activity.managerCik, activity.accessionNumber)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-xs font-semibold text-cyan-200 hover:text-cyan-100"
              >
                SEC filing
              </a>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && items.length > 0 && filteredItems.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No followed institution activity matches the current filters.
        </p>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          Follow institutions with parsed recent changes to build this feed.
        </p>
      ) : null}
    </section>
  );
}
