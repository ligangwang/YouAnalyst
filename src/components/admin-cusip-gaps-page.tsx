"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type CusipMappingGap = {
  cusip: string;
  nameOfIssuer: string | null;
  positionCount: number;
  totalValueUsd: number;
  latestReportDate: string | null;
  latestFilingDate: string | null;
  managers: Array<{
    managerCik: string;
    managerName: string | null;
    valueUsd: number;
    reportDate: string | null;
  }>;
};

type MappingSyncRun = {
  id: string;
  exchange: string | null;
  fetched: number;
  mapped: number;
  written: number;
  skipped: number;
  pages: number;
  hasMore: boolean;
  nextOffset: number | null;
  updatedAt: string | null;
};

type GapsResponse = {
  totalHoldings?: number;
  unmappedHoldings?: number;
  mappedHoldings?: number;
  unmappedShare?: number | null;
  sampledHoldings?: number;
  gaps?: CusipMappingGap[];
  recentMappingSyncs?: MappingSyncRun[];
  generatedAt?: string;
  error?: string;
};

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000_000_000 ? 1 : 0,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
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

function formatDate(value: string | null | undefined): string {
  return value || "-";
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{value}</p>
      {note ? <p className="mt-2 text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}

function GapRow({ gap }: { gap: CusipMappingGap }) {
  const topManager = gap.managers[0];

  return (
    <article className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[0.7fr_1.2fr_0.8fr_0.8fr_1.1fr]">
      <div>
        <p className="font-semibold text-cyan-100">{gap.cusip}</p>
        <p className="mt-1 text-xs text-slate-500">{gap.positionCount} positions</p>
      </div>
      <div>
        <p className="font-semibold text-slate-100">{gap.nameOfIssuer || "Unknown issuer"}</p>
        <p className="mt-1 text-xs text-slate-500">Latest report {formatDate(gap.latestReportDate)}</p>
      </div>
      <p className="font-semibold text-cyan-100">{formatMoney(gap.totalValueUsd)}</p>
      <p className="text-slate-300">{formatDate(gap.latestFilingDate)}</p>
      <div>
        <p className="text-slate-200">{topManager?.managerName || topManager?.managerCik || "-"}</p>
        {gap.managers.length > 1 ? <p className="mt-1 text-xs text-slate-500">+{gap.managers.length - 1} more managers in sample</p> : null}
      </div>
    </article>
  );
}

export function AdminCusipGapsPage() {
  const { user, loading, getIdToken } = useAuth();
  const [payload, setPayload] = useState<GapsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [sampleLimit, setSampleLimit] = useState("500");

  async function loadGaps() {
    setLoadingGaps(true);
    setError(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to view CUSIP mapping gaps.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to view CUSIP mapping gaps.");
      }

      const params = new URLSearchParams({ sampleLimit });
      const response = await fetch(`/api/admin/securities/cusip-gaps?${params.toString()}`, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const nextPayload = (await response.json().catch(() => ({}))) as GapsResponse;

      if (!response.ok) {
        throw new Error(nextPayload.error ?? "Unable to load CUSIP mapping gaps.");
      }

      setPayload(nextPayload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load CUSIP mapping gaps.");
    } finally {
      setLoadingGaps(false);
    }
  }

  useEffect(() => {
    if (loading) {
      return;
    }

    void loadGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const gaps = payload?.gaps ?? [];
  const recentSyncs = payload?.recentMappingSyncs ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="mb-3 text-sm font-medium text-cyan-200">Admin</p>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">CUSIP mapping gaps</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Find 13F holdings that could not be mapped to tickers, ranked by sampled position value.
          </p>
          {payload?.generatedAt ? <p className="mt-2 text-xs text-slate-500">Updated {formatDateTime(payload.generatedAt)}</p> : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid gap-1 text-xs text-slate-400">
            Sample limit
            <input
              type="number"
              min="1"
              max="1000"
              value={sampleLimit}
              onChange={(event) => setSampleLimit(event.target.value)}
              className="w-32 rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadGaps()}
            disabled={loadingGaps}
            className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
          >
            {loadingGaps ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total holdings" value={formatCount(payload?.totalHoldings ?? 0)} />
        <Metric label="Mapped holdings" value={formatCount(payload?.mappedHoldings ?? 0)} />
        <Metric label="Unmapped holdings" value={formatCount(payload?.unmappedHoldings ?? 0)} note={`${formatPercent(payload?.unmappedShare)} of holdings`} />
        <Metric label="Sampled gaps" value={formatCount(payload?.sampledHoldings ?? 0)} note={`${formatCount(gaps.length)} unique CUSIPs shown`} />
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Largest sampled gaps</h2>
        </div>
        {gaps.map((gap) => <GapRow key={gap.cusip} gap={gap} />)}
        {!loadingGaps && gaps.length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No unmapped holdings found in the current sample.</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent mapping syncs</h2>
        </div>
        {recentSyncs.map((run) => (
          <article key={run.id} className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[0.6fr_1fr_1fr_1fr_1fr]">
            <p className="font-semibold text-cyan-100">{run.exchange || "-"}</p>
            <p className="text-slate-300">{formatCount(run.fetched)} fetched<br /><span className="text-xs text-slate-500">{formatCount(run.mapped)} mapped</span></p>
            <p className="text-slate-300">{formatCount(run.written)} written<br /><span className="text-xs text-slate-500">{formatCount(run.skipped)} skipped</span></p>
            <p className="text-slate-300">{formatCount(run.pages)} pages<br /><span className="text-xs text-slate-500">{run.hasMore ? `next ${run.nextOffset ?? "-"}` : "complete"}</span></p>
            <p className="text-xs text-slate-400">{formatDateTime(run.updatedAt)}</p>
          </article>
        ))}
        {!loadingGaps && recentSyncs.length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No mapping sync runs have been recorded yet.</p>
        ) : null}
      </section>
    </main>
  );
}
