"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type {
  InstitutionDigestRunResult,
  InstitutionDigestRunSnapshot,
} from "@/lib/securities/institution-follows";

type DigestOpsResponse = {
  items?: InstitutionDigestRunSnapshot[];
  error?: string;
};

type DigestRunResponse = InstitutionDigestRunResult & {
  ok?: boolean;
  timestamp?: string;
  action?: "run";
  error?: string;
};

type RunStatusFilter = "all" | "live" | "dryRun" | "unread";

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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUserIds(value: string): string[] | undefined {
  const ids = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return ids.length > 0 ? ids : undefined;
}

function statusClass(status: string): string {
  if (status === "CHECKPOINTED") {
    return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "DRY_RUN") {
    return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
  }

  return "border-slate-500/30 bg-slate-800/60 text-slate-200";
}

function RunSummary({ result }: { result: DigestRunResponse | null }) {
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

  const failedUsers = result.users.filter((item) => item.error);

  return (
    <section className="mb-6 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-100">Digest run completed</p>
          <p className="mt-1 text-xs text-emerald-100/70">
            {result.dryRun ? "Dry run" : "Live checkpoint"} at {formatDateTime(result.timestamp ?? result.generatedAt)}
          </p>
        </div>
        <span className="w-fit rounded-full border border-emerald-300/30 px-2.5 py-1 text-xs font-semibold text-emerald-50">
          {formatCount(result.sendableUsers)} sendable users
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Scanned", result.scannedUsers],
          ["Candidates", result.candidateUsers],
          ["Items", result.totalItems],
          ["Failures", failedUsers.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <p className="text-xs uppercase text-emerald-200/70">{label}</p>
            <p className="mt-1 text-sm font-semibold text-emerald-50">{formatCount(Number(value))}</p>
          </div>
        ))}
      </div>

      {failedUsers.length > 0 ? (
        <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 p-3">
          <p className="text-xs font-semibold uppercase text-rose-100">Errors</p>
          <div className="mt-2 grid gap-2">
            {failedUsers.slice(0, 6).map((item) => (
              <p key={item.userId} className="text-xs text-rose-100">
                <span className="font-semibold">{item.userId}</span>: {item.error}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function AdminInstitutionDigestsPage() {
  const { user, loading, getIdToken } = useAuth();
  const [runs, setRuns] = useState<InstitutionDigestRunSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DigestRunResponse | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [confirmLiveRun, setConfirmLiveRun] = useState(false);
  const [limitUsers, setLimitUsers] = useState("50");
  const [limitItems, setLimitItems] = useState("50");
  const [userIds, setUserIds] = useState("");
  const [runFilter, setRunFilter] = useState<RunStatusFilter>("all");

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    setError(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to view institution digests.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to view institution digests.");
      }

      const response = await fetch("/api/admin/institutions/digests?limit=25", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as DigestOpsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load institution digest runs.");
      }

      setRuns(payload.items ?? []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load institution digest runs.");
    } finally {
      setLoadingRuns(false);
    }
  }, [getIdToken, user]);

  useEffect(() => {
    if (!loading && user) {
      void loadRuns();
    }
  }, [loadRuns, loading, user]);

  async function runDigest() {
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to run institution digests.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to run institution digests.");
      }

      const response = await fetch("/api/admin/institutions/digests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "run",
          dryRun,
          confirmCheckpoint: !dryRun && confirmLiveRun,
          limitUsers: parseNumber(limitUsers),
          limitItems: parseNumber(limitItems),
          userIds: parseUserIds(userIds),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as DigestRunResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to run institution digest.");
      }

      setResult(payload);
      await loadRuns();
    } catch (nextError) {
      setResult({
        dryRun,
        generatedAt: new Date().toISOString(),
        scannedUsers: 0,
        candidateUsers: 0,
        sendableUsers: 0,
        totalItems: 0,
        users: [],
        action: "run",
        error: nextError instanceof Error ? nextError.message : "Unable to run institution digest.",
      });
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <p className="text-sm text-slate-300">Loading admin tools...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/admin" className="text-sm text-cyan-300 hover:text-cyan-100">Admin</Link>
          <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">Institution digests</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Generate in-app digest snapshots for followed institutions and inspect recent run status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRuns()}
          disabled={loadingRuns}
          className="w-fit rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loadingRuns ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <RunSummary result={result} />
      {error ? <p className="mb-6 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      <section className="mb-6 rounded-2xl border border-white/15 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-2 text-sm text-slate-300">
            User limit
            <input
              type="number"
              min="1"
              max="500"
              value={limitUsers}
              onChange={(event) => setLimitUsers(event.target.value)}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
          </label>
          <label className="grid gap-2 text-sm text-slate-300">
            Item limit per user
            <input
              type="number"
              min="1"
              max="100"
              value={limitItems}
              onChange={(event) => setLimitItems(event.target.value)}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            />
          </label>
          <div className="flex items-end gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => {
                  setDryRun(event.target.checked);
                  setConfirmLiveRun(false);
                }}
                className="h-4 w-4 accent-cyan-400"
              />
              Dry run
            </label>
          </div>
        </div>

        <label className="mt-4 grid gap-2 text-sm text-slate-300">
          Explicit user IDs
          <textarea
            value={userIds}
            onChange={(event) => setUserIds(event.target.value)}
            rows={3}
            placeholder="Optional. Paste comma, space, or newline separated user IDs."
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
        </label>

        {!dryRun ? (
          <label className="mt-4 inline-flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm text-amber-100">
            <input
              type="checkbox"
              checked={confirmLiveRun}
              onChange={(event) => setConfirmLiveRun(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-300"
            />
            Confirm this live run should checkpoint user digest timestamps.
          </label>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void runDigest()}
            disabled={running || (!dryRun && !confirmLiveRun)}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
          >
            {running ? "Running..." : dryRun ? "Generate dry run" : "Generate live digest"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/15 bg-slate-900/70">
        <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent run records</h2>
            <p className="mt-1 text-sm text-slate-400">Latest saved digest snapshots across users.</p>
          </div>
          <label className="grid gap-1 text-xs text-slate-400">
            Filter
            <select
              value={runFilter}
              onChange={(event) => setRunFilter(event.target.value as RunStatusFilter)}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
            >
              <option value="all">All runs</option>
              <option value="live">Live</option>
              <option value="dryRun">Dry runs</option>
              <option value="unread">Unread live</option>
            </select>
          </label>
        </div>

        {runs.filter((run) => (
          runFilter === "all" ||
          (runFilter === "live" && !run.dryRun) ||
          (runFilter === "dryRun" && run.dryRun) ||
          (runFilter === "unread" && !run.dryRun && !run.readAt)
        )).length > 0 ? (
          <div className="divide-y divide-white/10">
            {runs.filter((run) => (
              runFilter === "all" ||
              (runFilter === "live" && !run.dryRun) ||
              (runFilter === "dryRun" && run.dryRun) ||
              (runFilter === "unread" && !run.dryRun && !run.readAt)
            )).map((run) => (
              <article key={run.id} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[1.1fr_0.8fr_0.8fr_0.8fr]">
                <div>
                  <p className="break-all font-semibold text-cyan-100">{run.userId}</p>
                  <p className="mt-1 text-xs text-slate-500">{run.id}</p>
                </div>
                <div>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(run.status)}`}>
                    {run.status}
                  </span>
                  <p className="mt-2 text-xs text-slate-400">{run.cadence} cadence</p>
                </div>
                <div>
                  <p className="text-slate-200">{formatCount(run.itemCount)} items</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatCount(run.summary.managerCount)} managers / {formatCount(run.summary.tickerCount)} tickers
                  </p>
                </div>
                <div>
                  <p className="text-slate-300">{formatDateTime(run.generatedAt)}</p>
                  <p className="mt-1 text-xs text-slate-500">Net {formatCurrency(run.summary.netValueChangeUsd)}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-slate-300">
            {loadingRuns ? "Loading digest runs..." : "No institution digest runs found."}
          </p>
        )}
      </section>
    </main>
  );
}
