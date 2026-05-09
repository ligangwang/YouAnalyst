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

type MappingApplyRun = {
  id: string;
  cusip: string | null;
  ticker: string | null;
  holdingsUpdated: number;
  changesUpdated: number;
  hasMore: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

type MappingBatchApplyRun = {
  id: string;
  cusipsScanned: number;
  cusipsWithMappings: number;
  holdingsUpdated: number;
  changesUpdated: number;
  hasMore: boolean;
  updatedBy: string | null;
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
  recentMappingApplies?: MappingApplyRun[];
  recentBatchApplies?: MappingBatchApplyRun[];
  generatedAt?: string;
  error?: string;
};

type OverrideResult = {
  ok?: boolean;
  action?: "applyOverride" | "applyMappedGaps";
  result?: {
    cusip?: string;
    ticker?: string;
    symbol?: string;
    exchange?: string;
    affectedCurrentHoldings?: number;
    holdingsUpdated?: number;
    changesUpdated?: number;
    hasMore?: boolean;
    cusipsScanned?: number;
    cusipsWithMappings?: number;
    items?: Array<{
      cusip: string;
      ticker: string;
      holdingsUpdated: number;
      changesUpdated: number;
      hasMore: boolean;
    }>;
    updatedAt: string;
  };
  error?: string;
};

type OverrideDraft = {
  cusip: string;
  ticker: string;
  symbol: string;
  exchange: string;
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

function GapRow({ gap, onSelect }: { gap: CusipMappingGap; onSelect: (gap: CusipMappingGap) => void }) {
  const topManager = gap.managers[0];

  return (
    <article className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[0.7fr_1.2fr_0.8fr_0.8fr_1.1fr_auto]">
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
      <button
        type="button"
        onClick={() => onSelect(gap)}
        className="h-fit rounded-xl border border-cyan-400/35 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
      >
        Map
      </button>
    </article>
  );
}

export function AdminCusipGapsPage() {
  const { user, loading, getIdToken } = useAuth();
  const [payload, setPayload] = useState<GapsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [sampleLimit, setSampleLimit] = useState("500");
  const [overrideDraft, setOverrideDraft] = useState<OverrideDraft | null>(null);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideApplying, setOverrideApplying] = useState(false);
  const [batchApplying, setBatchApplying] = useState(false);
  const [overrideResult, setOverrideResult] = useState<OverrideResult | null>(null);

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

  function selectGapForOverride(gap: CusipMappingGap) {
    setOverrideResult(null);
    setOverrideDraft({
      cusip: gap.cusip,
      ticker: "",
      symbol: "",
      exchange: "US",
    });
  }

  async function saveOverride() {
    if (!overrideDraft) {
      return;
    }

    setOverrideSaving(true);
    setOverrideResult(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to save CUSIP overrides.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to save CUSIP overrides.");
      }

      const response = await fetch("/api/admin/securities/cusip-gaps", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(overrideDraft),
      });
      const result = (await response.json().catch(() => ({}))) as OverrideResult;

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save CUSIP mapping override.");
      }

      setOverrideResult(result);
      setOverrideDraft(null);
      await loadGaps();
    } catch (nextError) {
      setOverrideResult({
        error: nextError instanceof Error ? nextError.message : "Unable to save CUSIP mapping override.",
      });
    } finally {
      setOverrideSaving(false);
    }
  }

  async function applyOverride(cusip: string) {
    setOverrideApplying(true);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to apply CUSIP overrides.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to apply CUSIP overrides.");
      }

      const response = await fetch("/api/admin/securities/cusip-gaps", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "applyOverride",
          cusip,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as OverrideResult;

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to apply CUSIP mapping override.");
      }

      setOverrideResult(result);
      await loadGaps();
    } catch (nextError) {
      setOverrideResult({
        error: nextError instanceof Error ? nextError.message : "Unable to apply CUSIP mapping override.",
      });
    } finally {
      setOverrideApplying(false);
    }
  }

  async function applyMappedGaps() {
    setBatchApplying(true);
    setOverrideResult(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to apply CUSIP mappings.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to apply CUSIP mappings.");
      }

      const response = await fetch("/api/admin/securities/cusip-gaps", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "applyMappedGaps",
          maxCusips: 25,
          limitPerCusip: 500,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as OverrideResult;

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to apply CUSIP mappings.");
      }

      setOverrideResult(result);
      await loadGaps();
    } catch (nextError) {
      setOverrideResult({
        error: nextError instanceof Error ? nextError.message : "Unable to apply CUSIP mappings.",
      });
    } finally {
      setBatchApplying(false);
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
  const recentApplies = payload?.recentMappingApplies ?? [];
  const recentBatchApplies = payload?.recentBatchApplies ?? [];

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
            disabled={loadingGaps || batchApplying}
            className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
          >
            {loadingGaps ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void applyMappedGaps()}
            disabled={batchApplying || loadingGaps}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
          >
            {batchApplying ? "Applying..." : "Apply mapped sample"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {overrideResult?.error ? (
        <p className="mb-6 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{overrideResult.error}</p>
      ) : null}

      {overrideResult?.result ? (
        <section className="mb-6 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4">
          {overrideResult.action === "applyMappedGaps" ? (
            <>
              <p className="text-sm font-semibold text-emerald-100">Applied mapped CUSIP sample</p>
              <p className="mt-1 text-sm text-emerald-50/80">
                Scanned {formatCount(overrideResult.result.cusipsScanned ?? 0)} CUSIPs, found {formatCount(overrideResult.result.cusipsWithMappings ?? 0)} mappings, and updated {formatCount(overrideResult.result.holdingsUpdated ?? 0)} holdings plus {formatCount(overrideResult.result.changesUpdated ?? 0)} holding changes.
                {overrideResult.result.hasMore ? " Run it again to continue the bounded refresh." : ""}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-emerald-100">
                {overrideResult.action === "applyOverride" ? "Applied" : "Saved"} {overrideResult.result.cusip} to {overrideResult.result.ticker}
              </p>
              {overrideResult.action === "applyOverride" ? (
                <p className="mt-1 text-sm text-emerald-50/80">
                  Updated {formatCount(overrideResult.result.holdingsUpdated ?? 0)} holdings and {formatCount(overrideResult.result.changesUpdated ?? 0)} holding changes.
                  {overrideResult.result.hasMore ? " Run apply again to continue the bounded refresh." : ""}
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <p className="text-sm text-emerald-50/80">
                    {formatCount(overrideResult.result.affectedCurrentHoldings ?? 0)} current unmapped holdings can be refreshed with this override.
                  </p>
                  <button
                    type="button"
                    onClick={() => void applyOverride(overrideResult.result?.cusip ?? "")}
                    disabled={overrideApplying}
                    className="w-fit rounded-xl border border-emerald-200/50 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-300/10 disabled:opacity-60"
                  >
                    {overrideApplying ? "Applying..." : "Apply now"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      ) : null}

      {overrideDraft ? (
        <section className="mb-6 rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Mapping override</p>
              <h2 className="mt-2 font-[var(--font-sora)] text-xl font-semibold text-cyan-100">{overrideDraft.cusip}</h2>
            </div>
            <button
              type="button"
              onClick={() => setOverrideDraft(null)}
              className="w-fit rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_0.7fr_auto] lg:items-end">
            <label className="grid gap-1 text-xs text-slate-400">
              Ticker
              <input
                type="text"
                value={overrideDraft.ticker}
                onChange={(event) => setOverrideDraft({ ...overrideDraft, ticker: event.target.value })}
                placeholder="AAPL"
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Provider symbol
              <input
                type="text"
                value={overrideDraft.symbol}
                onChange={(event) => setOverrideDraft({ ...overrideDraft, symbol: event.target.value })}
                placeholder="AAPL.US"
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Exchange
              <input
                type="text"
                value={overrideDraft.exchange}
                onChange={(event) => setOverrideDraft({ ...overrideDraft, exchange: event.target.value })}
                placeholder="US"
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveOverride()}
              disabled={overrideSaving}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {overrideSaving ? "Saving..." : "Save override"}
            </button>
          </div>
        </section>
      ) : null}

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
        {gaps.map((gap) => <GapRow key={gap.cusip} gap={gap} onSelect={selectGapForOverride} />)}
        {!loadingGaps && gaps.length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No unmapped holdings found in the current sample.</p>
        ) : null}
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
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

      <section className="mb-6 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent mapping applies</h2>
        </div>
        {recentApplies.map((run) => (
          <article key={run.id} className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[0.8fr_0.8fr_1fr_1fr_1fr]">
            <p className="font-semibold text-cyan-100">{run.cusip || "-"}</p>
            <p className="font-semibold text-slate-100">{run.ticker || "-"}</p>
            <p className="text-slate-300">{formatCount(run.holdingsUpdated)} holdings<br /><span className="text-xs text-slate-500">{formatCount(run.changesUpdated)} changes</span></p>
            <p className="text-slate-300">{run.hasMore ? "More remaining" : "Complete"}<br /><span className="text-xs text-slate-500">{run.updatedBy || "-"}</span></p>
            <p className="text-xs text-slate-400">{formatDateTime(run.updatedAt)}</p>
          </article>
        ))}
        {!loadingGaps && recentApplies.length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No mapping apply runs have been recorded yet.</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent batch applies</h2>
        </div>
        {recentBatchApplies.map((run) => (
          <article key={run.id} className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[1fr_1fr_1fr_1fr]">
            <p className="font-semibold text-cyan-100">{formatCount(run.cusipsWithMappings)} mapped<br /><span className="text-xs text-slate-500">{formatCount(run.cusipsScanned)} scanned</span></p>
            <p className="text-slate-300">{formatCount(run.holdingsUpdated)} holdings<br /><span className="text-xs text-slate-500">{formatCount(run.changesUpdated)} changes</span></p>
            <p className="text-slate-300">{run.hasMore ? "More remaining" : "Complete"}<br /><span className="text-xs text-slate-500">{run.updatedBy || "-"}</span></p>
            <p className="text-xs text-slate-400">{formatDateTime(run.updatedAt)}</p>
          </article>
        ))}
        {!loadingGaps && recentBatchApplies.length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No batch apply runs have been recorded yet.</p>
        ) : null}
      </section>
    </main>
  );
}
