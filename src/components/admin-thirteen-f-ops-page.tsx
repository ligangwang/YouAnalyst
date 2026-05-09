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

type ActionResponse = {
  ok?: boolean;
  action?: "discover" | "processQueue" | "backfill";
  result?: Record<string, unknown>;
  timestamp?: string;
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

function ActionResult({ result }: { result: ActionResponse | null }) {
  if (!result) {
    return null;
  }

  if (result.error) {
    return (
      <p className="mb-6 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
        {result.error}
      </p>
    );
  }

  const payload = result.result ?? {};
  const summaryItems = [
    ["Action", result.action ?? "-"],
    ["Updated", formatDateTime(result.timestamp)],
    ["Found", payload.filingsFound],
    ["Queued", payload.filingsQueued],
    ["Processed", payload.processed ?? payload.filingsProcessed],
    ["Parsed", payload.parsed ?? payload.filingsParsed],
    ["Failed", payload.failed ?? payload.filingsFailed],
    ["Skipped", payload.skipped ?? payload.filingsSkipped],
  ].filter((item): item is [string, string | number] => (
    typeof item[0] === "string" &&
    (typeof item[1] === "string" || typeof item[1] === "number")
  ));

  return (
    <section className="mb-6 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4">
      <p className="text-sm font-semibold text-emerald-100">Last action completed</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {summaryItems.map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <p className="text-xs uppercase text-emerald-200/70">{label}</p>
            <p className="mt-1 text-sm font-semibold text-emerald-50">{typeof value === "number" ? formatCount(value) : String(value)}</p>
          </div>
        ))}
      </div>
    </section>
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
  const [runningAction, setRunningAction] = useState<ActionResponse["action"] | null>(null);
  const [actionResult, setActionResult] = useState<ActionResponse | null>(null);
  const [discoverDate, setDiscoverDate] = useState("");
  const [discoverLookbackDays, setDiscoverLookbackDays] = useState("3");
  const [discoverMaxFilings, setDiscoverMaxFilings] = useState("5000");
  const [discoverDryRun, setDiscoverDryRun] = useState(true);
  const [queueLimit, setQueueLimit] = useState("25");
  const [queueDryRun, setQueueDryRun] = useState(true);
  const [queueIncludeStale, setQueueIncludeStale] = useState(true);
  const [queueStaleMinutes, setQueueStaleMinutes] = useState("60");
  const [backfillStartDate, setBackfillStartDate] = useState("");
  const [backfillEndDate, setBackfillEndDate] = useState("");
  const [backfillMaxBatches, setBackfillMaxBatches] = useState("1");
  const [backfillBatchSize, setBackfillBatchSize] = useState("25");
  const [backfillDryRun, setBackfillDryRun] = useState(true);

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

  async function runAdminAction(action: ActionResponse["action"], body: Record<string, unknown>) {
    setRunningAction(action);
    setError(null);
    setActionResult(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to run 13F actions.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to run 13F actions.");
      }

      const response = await fetch("/api/admin/securities/13f", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, ...body }),
      });
      const nextResult = (await response.json().catch(() => ({}))) as ActionResponse;

      if (!response.ok) {
        throw new Error(nextResult.error ?? "Unable to run 13F action.");
      }

      setActionResult(nextResult);
      await loadOps();
    } catch (nextError) {
      setActionResult({
        error: nextError instanceof Error ? nextError.message : "Unable to run 13F action.",
      });
    } finally {
      setRunningAction(null);
    }
  }

  function runDiscovery() {
    const trimmedDate = discoverDate.trim();
    return runAdminAction("discover", {
      date: trimmedDate || undefined,
      lookbackDays: trimmedDate ? undefined : Number(discoverLookbackDays),
      maxFilings: Number(discoverMaxFilings),
      dryRun: discoverDryRun,
    });
  }

  function runQueue() {
    return runAdminAction("processQueue", {
      limit: Number(queueLimit),
      dryRun: queueDryRun,
      includeStaleProcessing: queueIncludeStale,
      staleProcessingMinutes: Number(queueStaleMinutes),
    });
  }

  function runBackfill() {
    if (!backfillStartDate.trim() || !backfillEndDate.trim()) {
      setActionResult({ error: "Choose a start date and end date before running a backfill." });
      return Promise.resolve();
    }

    return runAdminAction("backfill", {
      startDate: backfillStartDate.trim() || undefined,
      endDate: backfillEndDate.trim() || undefined,
      processBatchSize: Number(backfillBatchSize),
      maxProcessBatches: Number(backfillMaxBatches),
      dryRun: backfillDryRun,
      includeStaleProcessing: true,
    });
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
      <ActionResult result={actionResult} />

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/15 bg-slate-900/70 p-5">
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Discovery</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Find SEC filings</h2>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs text-slate-400">
              Index date
              <input
                type="date"
                value={discoverDate}
                onChange={(event) => setDiscoverDate(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Lookback days
              <input
                type="number"
                min="1"
                max="14"
                value={discoverLookbackDays}
                onChange={(event) => setDiscoverLookbackDays(event.target.value)}
                disabled={discoverDate.trim().length > 0}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring disabled:opacity-50"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Max filings
              <input
                type="number"
                min="1"
                max="5000"
                value={discoverMaxFilings}
                onChange={(event) => setDiscoverMaxFilings(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={discoverDryRun} onChange={(event) => setDiscoverDryRun(event.target.checked)} />
              Dry run
            </label>
            <button
              type="button"
              onClick={() => void runDiscovery()}
              disabled={runningAction !== null}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {runningAction === "discover" ? "Running..." : "Run discovery"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/15 bg-slate-900/70 p-5">
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Queue</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Process filings</h2>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs text-slate-400">
              Batch limit
              <input
                type="number"
                min="1"
                max="100"
                value={queueLimit}
                onChange={(event) => setQueueLimit(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Stale minutes
              <input
                type="number"
                min="5"
                max="1440"
                value={queueStaleMinutes}
                onChange={(event) => setQueueStaleMinutes(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={queueIncludeStale} onChange={(event) => setQueueIncludeStale(event.target.checked)} />
              Include stale processing
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={queueDryRun} onChange={(event) => setQueueDryRun(event.target.checked)} />
              Dry run
            </label>
            <button
              type="button"
              onClick={() => void runQueue()}
              disabled={runningAction !== null}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {runningAction === "processQueue" ? "Running..." : "Process queue"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/15 bg-slate-900/70 p-5">
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Backfill</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Run bounded backfill</h2>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-xs text-slate-400">
              Start date
              <input
                type="date"
                value={backfillStartDate}
                onChange={(event) => setBackfillStartDate(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              End date
              <input
                type="date"
                value={backfillEndDate}
                onChange={(event) => setBackfillEndDate(event.target.value)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-slate-400">
                Batches
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={backfillMaxBatches}
                  onChange={(event) => setBackfillMaxBatches(event.target.value)}
                  className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                />
              </label>
              <label className="grid gap-1 text-xs text-slate-400">
                Batch size
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={backfillBatchSize}
                  onChange={(event) => setBackfillBatchSize(event.target.value)}
                  className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={backfillDryRun} onChange={(event) => setBackfillDryRun(event.target.checked)} />
              Dry run
            </label>
            <button
              type="button"
              onClick={() => void runBackfill()}
              disabled={runningAction !== null}
              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {runningAction === "backfill" ? "Running..." : "Run backfill"}
            </button>
          </div>
        </div>
      </section>

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
