"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type QueueStatus = "DISCOVERED" | "PROCESSING" | "PARSED" | "FAILED" | "SKIPPED";

type RecentFiling = {
  accessionNumber: string;
  managerCik: string | null;
  managerName: string | null;
  form: string | null;
  filingDate: string | null;
  reportDate: string | null;
  status: string | null;
  canonicalStatus: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string | null;
  processedAt: string | null;
};

type BackfillRun = {
  runId: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  filingsFound: number;
  filingsQueued: number;
  filingsProcessed: number;
  filingsParsed: number;
  filingsFailed: number;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
};

type OpsResponse = {
  queue?: {
    statuses: Record<QueueStatus, number>;
    queuedOrProcessing: number;
    staleProcessing: number;
  };
  latestParsed?: RecentFiling | null;
  recentFailures?: RecentFiling[];
  recentFilings?: RecentFiling[];
  recentBackfills?: BackfillRun[];
  generatedAt?: string;
  error?: string;
};

const QUEUE_STATUSES: QueueStatus[] = ["DISCOVERED", "PROCESSING", "PARSED", "FAILED", "SKIPPED"];

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
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

function StatusCard({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{formatCount(value)}</p>
      {note ? <p className="mt-2 text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}

function statusClass(status: string | null | undefined): string {
  switch (status) {
    case "FAILED":
    case "PARTIAL":
      return "border-rose-400/30 bg-rose-500/10 text-rose-100";
    case "PROCESSING":
    case "RUNNING":
      return "border-amber-300/30 bg-amber-400/10 text-amber-100";
    case "PARSED":
    case "COMPLETED":
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

function FilingRow({ filing }: { filing: RecentFiling }) {
  return (
    <article className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[1.1fr_0.7fr_0.8fr_0.8fr_1fr]">
      <div>
        <p className="font-semibold text-cyan-100">{filing.managerName || filing.managerCik || "Unknown manager"}</p>
        <p className="mt-1 break-all text-xs text-slate-500">{filing.accessionNumber}</p>
      </div>
      <div>
        <StatusPill value={filing.status} />
        {filing.canonicalStatus ? <p className="mt-2 text-xs text-slate-400">{filing.canonicalStatus}</p> : null}
      </div>
      <p className="text-slate-300">{filing.form || "-"}<br /><span className="text-xs text-slate-500">{formatDate(filing.filingDate)}</span></p>
      <p className="text-slate-300">{formatDate(filing.reportDate)}<br /><span className="text-xs text-slate-500">{filing.attempts} attempts</span></p>
      <div>
        <p className="text-xs text-slate-400">{formatDateTime(filing.updatedAt)}</p>
        {filing.lastError ? <p className="mt-1 line-clamp-2 text-xs text-rose-200">{filing.lastError}</p> : null}
      </div>
    </article>
  );
}

export function AdminThirteenFOpsPage() {
  const { user, loading, getIdToken } = useAuth();
  const [payload, setPayload] = useState<OpsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOps, setLoadingOps] = useState(false);

  async function loadOps() {
    setLoadingOps(true);
    setError(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to view 13F operations.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to view 13F operations.");
      }

      const response = await fetch("/api/admin/securities/13f", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const nextPayload = (await response.json().catch(() => ({}))) as OpsResponse;

      if (!response.ok) {
        throw new Error(nextPayload.error ?? "Unable to load 13F operations.");
      }

      setPayload(nextPayload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load 13F operations.");
    } finally {
      setLoadingOps(false);
    }
  }

  useEffect(() => {
    if (loading) {
      return;
    }

    void loadOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const queue = payload?.queue;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="mb-3 text-sm font-medium text-cyan-200">Admin</p>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">13F operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Monitor SEC discovery, queue processing, canonical parsing, and historical backfills.
          </p>
          {payload?.generatedAt ? <p className="mt-2 text-xs text-slate-500">Updated {formatDateTime(payload.generatedAt)}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void loadOps()}
          disabled={loadingOps}
          className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loadingOps ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard label="Queued or processing" value={queue?.queuedOrProcessing ?? 0} note="Ready plus active filings" />
        <StatusCard label="Stale processing" value={queue?.staleProcessing ?? 0} note="Older than 60 minutes" />
        <StatusCard label="Parsed filings" value={queue?.statuses.PARSED ?? 0} note={payload?.latestParsed ? `Latest ${formatDate(payload.latestParsed.reportDate)}` : "No parsed filings"} />
        <StatusCard label="Failed filings" value={queue?.statuses.FAILED ?? 0} note="Needs review or retry" />
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-5">
        {QUEUE_STATUSES.map((status) => (
          <div key={status} className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
            <p className="text-xs uppercase text-slate-500">{status}</p>
            <p className="mt-2 font-[var(--font-sora)] text-xl font-semibold text-cyan-100">
              {formatCount(queue?.statuses[status] ?? 0)}
            </p>
          </div>
        ))}
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent backfills</h2>
        </div>
        {(payload?.recentBackfills ?? []).map((run) => (
          <article key={run.runId} className="grid grid-cols-1 gap-3 border-b border-white/10 px-4 py-4 text-sm last:border-b-0 lg:grid-cols-[1.1fr_0.7fr_0.8fr_1fr_1fr]">
            <div>
              <p className="font-semibold text-cyan-100">{run.runId}</p>
              <p className="mt-1 text-xs text-slate-500">{formatDate(run.startDate)} to {formatDate(run.endDate)}</p>
            </div>
            <StatusPill value={run.status} />
            <p className="text-slate-300">{formatCount(run.filingsFound)} found<br /><span className="text-xs text-slate-500">{formatCount(run.filingsQueued)} queued</span></p>
            <p className="text-slate-300">{formatCount(run.filingsProcessed)} processed<br /><span className="text-xs text-slate-500">{formatCount(run.filingsParsed)} parsed, {formatCount(run.filingsFailed)} failed</span></p>
            <div>
              <p className="text-xs text-slate-400">{formatDateTime(run.updatedAt)}</p>
              {run.lastError ? <p className="mt-1 line-clamp-2 text-xs text-rose-200">{run.lastError}</p> : null}
            </div>
          </article>
        ))}
        {!loadingOps && (payload?.recentBackfills ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No 13F backfill runs have been recorded yet.</p>
        ) : null}
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent failures</h2>
        </div>
        {(payload?.recentFailures ?? []).map((filing) => <FilingRow key={filing.accessionNumber} filing={filing} />)}
        {!loadingOps && (payload?.recentFailures ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No recent failed filings in the latest activity window.</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950/55">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent queue activity</h2>
        </div>
        {(payload?.recentFilings ?? []).slice(0, 20).map((filing) => <FilingRow key={filing.accessionNumber} filing={filing} />)}
        {!loadingOps && (payload?.recentFilings ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-300">No 13F queue records have been discovered yet.</p>
        ) : null}
      </section>
    </main>
  );
}
