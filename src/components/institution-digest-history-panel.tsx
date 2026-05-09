"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { InstitutionDigestRunSnapshot } from "@/lib/securities/institution-follows";

type DigestRunsResponse = {
  items?: InstitutionDigestRunSnapshot[];
  error?: string;
};

type GroupBy = "none" | "institution" | "ticker";
type RunFilter = "all" | "unread" | "live" | "dryRun";
type SortOrder = "newest" | "oldest";

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

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
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

function changeTone(status: string): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

function filingUrl(item: InstitutionDigestRunSnapshot["items"][number]): string {
  const accessionPath = item.accessionNumber.replace(/-/g, "");
  const cikPath = String(Number(item.managerCik));
  return `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accessionPath}/${item.accessionNumber}.txt`;
}

function groupItems(items: InstitutionDigestRunSnapshot["items"], groupBy: GroupBy) {
  if (groupBy === "none") {
    return [{ label: "All activity", items }];
  }

  const groups = new Map<string, InstitutionDigestRunSnapshot["items"]>();

  for (const item of items) {
    const key = groupBy === "institution"
      ? item.managerName
      : item.ticker ?? item.nameOfIssuer;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, groupedItems]) => ({ label, items: groupedItems }));
}

export function InstitutionDigestHistoryPanel() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<InstitutionDigestRunSnapshot[]>([]);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [groupBy, setGroupBy] = useState<GroupBy>("institution");
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    let cancelled = false;

    void getIdToken()
      .then(async (token) => {
        if (!token) {
          throw new Error("Sign in to load institution digests.");
        }

        const response = await fetch("/api/institutions/follows/digest/runs?limit=8", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as DigestRunsResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load institution digests.");
        }

        if (!cancelled) {
          setItems(payload.items ?? []);
          setLoadedForUser(user.uid);
          setExpandedRunId(payload.items?.[0]?.id ?? null);
          setError(null);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load institution digests.");
          setLoadedForUser(user.uid);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, user]);

  async function markRead(runId: string) {
    if (!user) {
      return;
    }

    setMarkingReadId(runId);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in to update institution digests.");
      }

      const response = await fetch(`/api/institutions/follows/digest/runs/${encodeURIComponent(runId)}/read`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as { readAt?: string; error?: string };

      if (!response.ok || !payload.readAt) {
        throw new Error(payload.error ?? "Unable to mark digest as read.");
      }

      setItems((currentItems) => currentItems.map((item) => (
        item.id === runId ? { ...item, readAt: payload.readAt ?? new Date().toISOString() } : item
      )));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to mark digest as read.");
    } finally {
      setMarkingReadId(null);
    }
  }

  if (authLoading || !user) {
    return null;
  }

  const loading = loadedForUser !== user.uid;
  const unreadCount = items.filter((run) => !run.readAt && !run.dryRun).length;
  const displayedItems = items
    .filter((run) => {
      if (filter === "unread") {
        return !run.readAt && !run.dryRun;
      }

      if (filter === "live") {
        return !run.dryRun;
      }

      if (filter === "dryRun") {
        return run.dryRun;
      }

      return true;
    })
    .sort((left, right) => {
      const comparison = right.generatedAt.localeCompare(left.generatedAt);
      return sortOrder === "newest" ? comparison : -comparison;
    });

  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Institution digests</h2>
            {unreadCount > 0 ? (
              <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                {unreadCount.toLocaleString()} unread
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-400">Saved in-app summaries generated from followed institutions.</p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as RunFilter)}
            className="rounded-lg border border-white/15 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none ring-cyan-400/40 focus:ring"
          >
            <option value="all">All</option>
            <option value="unread">Unread live</option>
            <option value="live">Live</option>
            <option value="dryRun">Dry runs</option>
          </select>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
            className="rounded-lg border border-white/15 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none ring-cyan-400/40 focus:ring"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
            className="rounded-lg border border-white/15 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none ring-cyan-400/40 focus:ring"
          >
            <option value="institution">By institution</option>
            <option value="ticker">By ticker</option>
            <option value="none">Ungrouped</option>
          </select>
        </div>
      </div>

      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-300">Loading institution digests...</p> : null}

      {!loading && displayedItems.length > 0 ? (
        <div className="grid gap-3">
          {displayedItems.map((run) => {
            const expanded = expandedRunId === run.id;
            const unread = !run.readAt && !run.dryRun;
            return (
              <article key={run.id} className={`rounded-xl border p-4 ${unread ? "border-cyan-300/35 bg-cyan-400/10" : "border-white/10 bg-slate-900/60"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-cyan-100">{formatDateTime(run.generatedAt)}</h3>
                      {unread ? (
                        <span className="rounded-full border border-cyan-300/35 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                          Unread
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {run.cadence} / {run.status} / {run.itemCount.toLocaleString()} items
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full border border-white/10 px-2 py-1">New {run.summary.newCount.toLocaleString()}</span>
                      <span className="rounded-full border border-white/10 px-2 py-1">Increased {run.summary.increasedCount.toLocaleString()}</span>
                      <span className="rounded-full border border-white/10 px-2 py-1">Reduced {run.summary.reducedCount.toLocaleString()}</span>
                      <span className="rounded-full border border-white/10 px-2 py-1">Sold out {run.summary.soldOutCount.toLocaleString()}</span>
                      <span className="rounded-full border border-white/10 px-2 py-1">Net {formatSignedCurrency(run.summary.netValueChangeUsd)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {unread ? (
                      <button
                        type="button"
                        onClick={() => void markRead(run.id)}
                        disabled={markingReadId === run.id}
                        className="w-fit rounded-xl border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
                      >
                        {markingReadId === run.id ? "Saving..." : "Mark read"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(expanded ? null : run.id)}
                      className="w-fit rounded-xl border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
                    >
                      {expanded ? "Hide" : "Open"}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="mt-4 grid gap-2">
                    {run.items.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-slate-300">
                        This digest had no activity items to display.
                      </p>
                    ) : (
                      groupItems(run.items, groupBy).map((group) => (
                        <div key={`${run.id}_${group.label}`} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                          {groupBy !== "none" ? (
                            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                              {group.label} / {group.items.length.toLocaleString()} items
                            </p>
                          ) : null}
                          <div className="grid gap-2">
                            {group.items.map((item) => (
                              <div key={`${run.id}_${item.positionKey}`} className="rounded-lg border border-white/10 bg-slate-950/55 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <Link href={`/institutions/${item.managerCik}`} className="font-semibold text-slate-100 hover:text-cyan-200">
                                      {item.managerName}
                                    </Link>
                                    <p className="mt-1 text-sm text-slate-300">
                                      {item.ticker ? (
                                        <Link href={`/ticker/${item.ticker}`} className="font-semibold text-cyan-100 hover:text-cyan-300">
                                          {item.ticker}
                                        </Link>
                                      ) : (
                                        <span className="font-semibold text-slate-100">Unmapped</span>
                                      )}{" "}
                                      <span className="text-slate-400">{item.nameOfIssuer}</span>
                                    </p>
                                  </div>
                                  <span className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(item.status)}`}>
                                    {item.status}
                                  </span>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                                  <span>Value <strong className="text-slate-100">{formatSignedCurrency(item.valueChangeUsd)}</strong></span>
                                  <span>Report <strong className="text-slate-100">{item.reportDate}</strong></span>
                                  <a
                                    href={filingUrl(item)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-semibold text-cyan-200 hover:text-cyan-100"
                                  >
                                    SEC filing
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && items.length > 0 && displayedItems.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No digests match the selected filters.
        </p>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No institution digests have been generated yet.
        </p>
      ) : null}
    </section>
  );
}
