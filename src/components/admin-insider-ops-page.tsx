"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type RecentFiling = {
  accessionNumber: string;
  filingDate: string | null;
  form: string | null;
  indexCik: string | null;
  indexCompanyName: string | null;
  status: string | null;
  transactionsWritten: number;
  lastError: string | null;
  parsedAt: string | null;
  updatedAt: string | null;
};

type RecentTransaction = {
  id: string;
  accessionNumber: string | null;
  ticker: string | null;
  issuerName: string | null;
  reportingOwnerName: string | null;
  transactionCode: string | null;
  transactionDate: string | null;
  shares: number | null;
  pricePerShare: number | null;
  valueUsd: number | null;
  filingDate: string | null;
  updatedAt: string | null;
};

type OpsResponse = {
  filings?: {
    statuses: Record<"PROCESSING" | "PARSED" | "FAILED", number>;
    totalTracked: number;
  };
  recentFilings?: RecentFiling[];
  recentFailures?: RecentFiling[];
  recentTransactions?: RecentTransaction[];
  generatedAt?: string;
  error?: string;
};

function formatCount(value: number | null | undefined): string {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString();
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
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

function StatusCard({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{formatCount(value)}</p>
    </div>
  );
}

function statusClass(status: string | null | undefined): string {
  switch (status) {
    case "FAILED":
      return "border-rose-400/30 bg-rose-500/10 text-rose-100";
    case "PROCESSING":
      return "border-amber-300/30 bg-amber-400/10 text-amber-100";
    case "PARSED":
      return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
    default:
      return "border-slate-500/30 bg-slate-800/60 text-slate-200";
  }
}

function StatusPill({ value }: { value: string | null | undefined }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(value)}`}>
      {value || "UNKNOWN"}
    </span>
  );
}

export function AdminInsiderOpsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<OpsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user) {
        if (!cancelled) {
          setData(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/admin/securities/insiders", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const body = (await response.json().catch(() => ({}))) as OpsResponse;
        if (!response.ok) {
          throw new Error(body.error ?? "Unable to load insider transaction operations.");
        }
        if (!cancelled) {
          setData(body);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load insider transaction operations.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const statuses = data?.filings?.statuses;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Admin</p>
        <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">Insider Transactions</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Monitor SEC Form 4 ingestion, parsed filings, failures, and latest open-market insider transactions.
        </p>
        {data?.generatedAt ? <p className="mt-2 text-xs text-slate-500">Generated {formatDateTime(data.generatedAt)}</p> : null}
      </div>

      {loading ? <p className="rounded-xl border border-white/10 bg-slate-900/70 p-4 text-slate-300">Loading insider transaction operations...</p> : null}
      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</p> : null}

      {data ? (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-4">
            <StatusCard label="Tracked filings" value={data.filings?.totalTracked} />
            <StatusCard label="Parsed" value={statuses?.PARSED} />
            <StatusCard label="Processing" value={statuses?.PROCESSING} />
            <StatusCard label="Failed" value={statuses?.FAILED} />
          </section>

          <section className="mb-6 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent transactions</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Ticker</th>
                    <th className="px-3 py-2">Issuer</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Shares</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(data.recentTransactions ?? []).map((item) => (
                    <tr key={item.id} className="text-slate-200">
                      <td className="px-3 py-3 font-semibold text-cyan-100">{item.ticker ?? "-"}</td>
                      <td className="px-3 py-3">{item.issuerName ?? "-"}</td>
                      <td className="px-3 py-3">{item.reportingOwnerName ?? "-"}</td>
                      <td className="px-3 py-3">{item.transactionCode ?? "-"}</td>
                      <td className="px-3 py-3">{item.transactionDate ?? "-"}</td>
                      <td className="px-3 py-3 text-right">{formatNumber(item.shares)}</td>
                      <td className="px-3 py-3 text-right">{formatMoney(item.valueUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent filings</h2>
              <div className="mt-4 grid gap-3">
                {(data.recentFilings ?? []).map((filing) => (
                  <article key={filing.accessionNumber} className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-100">{filing.indexCompanyName ?? filing.accessionNumber}</p>
                        <p className="mt-1 text-xs text-slate-500">{filing.accessionNumber} · {filing.form ?? "-"} · {filing.filingDate ?? "-"}</p>
                      </div>
                      <StatusPill value={filing.status} />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">Transactions written: {formatCount(filing.transactionsWritten)}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent failures</h2>
              <div className="mt-4 grid gap-3">
                {(data.recentFailures ?? []).length > 0 ? (data.recentFailures ?? []).map((filing) => (
                  <article key={filing.accessionNumber} className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3">
                    <p className="font-semibold text-rose-100">{filing.indexCompanyName ?? filing.accessionNumber}</p>
                    <p className="mt-1 text-xs text-rose-100/70">{filing.accessionNumber} · {filing.filingDate ?? "-"}</p>
                    <p className="mt-2 text-xs text-rose-100">{filing.lastError ?? "Unknown error"}</p>
                  </article>
                )) : (
                  <p className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-slate-400">No recent insider filing failures.</p>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
