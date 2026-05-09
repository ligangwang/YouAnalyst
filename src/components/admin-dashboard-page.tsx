"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type AdminStats = {
  users: number;
  predictions: number;
  feedback: number;
};

type UserPlan = "FREE" | "PRO";

type PlanLookup = {
  id: string;
  displayName: string | null;
  nickname: string | null;
  email: string | null;
  plan: UserPlan;
  canUsePro: boolean;
};

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function countFromPayload(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AdminDashboardPage() {
  const { user, loading, getIdToken } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planIdentifier, setPlanIdentifier] = useState("");
  const [planLookup, setPlanLookup] = useState<PlanLookup | null>(null);
  const [planSelection, setPlanSelection] = useState<UserPlan>("FREE");
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);

  useEffect(() => {
    if (loading) {
      return;
    }

    let cancelled = false;

    async function loadStats() {
      try {
        if (!user) {
          throw new Error("Sign in with an admin account to view admin tools.");
        }

        const token = await getIdToken();
        if (!token) {
          throw new Error("Sign in with an admin account to view admin tools.");
        }

        const response = await fetch("/api/admin/stats", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        const payload = (await response.json().catch(() => ({}))) as Partial<AdminStats> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load admin stats.");
        }

        if (!cancelled) {
          setStats({
            users: countFromPayload(payload.users),
            predictions: countFromPayload(payload.predictions),
            feedback: countFromPayload(payload.feedback),
          });
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load admin stats.");
        }
      }
    }

    void loadStats();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, loading, user]);

  async function loadPlanLookup() {
    const identifier = planIdentifier.trim();
    if (!identifier) {
      setPlanMessage("Enter a user id, email, or nickname.");
      setPlanLookup(null);
      return;
    }

    setPlanLoading(true);
    setPlanMessage(null);
    setPlanLookup(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to manage plans.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to manage plans.");
      }

      const response = await fetch(`/api/admin/users/plan?q=${encodeURIComponent(identifier)}`, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: PlanLookup;
      };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Unable to load user plan.");
      }

      setPlanLookup(payload.user);
      setPlanSelection(payload.user.plan);
    } catch (nextError) {
      setPlanLookup(null);
      setPlanMessage(nextError instanceof Error ? nextError.message : "Unable to load user plan.");
    } finally {
      setPlanLoading(false);
    }
  }

  async function savePlan() {
    if (!planLookup) {
      setPlanMessage("Load a user before saving a plan.");
      return;
    }

    setPlanSaving(true);
    setPlanMessage(null);

    try {
      if (!user) {
        throw new Error("Sign in with an admin account to manage plans.");
      }

      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to manage plans.");
      }

      const response = await fetch("/api/admin/users/plan", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          identifier: planLookup.id,
          plan: planSelection,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: PlanLookup;
      };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Unable to update user plan.");
      }

      setPlanLookup(payload.user);
      setPlanSelection(payload.user.plan);
      setPlanMessage(`Updated ${payload.user.nickname ? `@${payload.user.nickname}` : payload.user.id} to ${payload.user.plan}.`);
    } catch (nextError) {
      setPlanMessage(nextError instanceof Error ? nextError.message : "Unable to update user plan.");
    } finally {
      setPlanSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <p className="mb-3 text-sm font-medium text-cyan-200">Admin</p>

      <div className="mb-6 max-w-3xl">
        <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">Admin dashboard</h1>
        <p className="mt-2 text-sm text-slate-300">
          Manage AI analyst drafts and review user feedback from one place.
        </p>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-500">Users</p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
            {stats ? formatCount(stats.users) : <>&mdash;</>}
          </p>
        </div>
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-500">Predictions</p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
            {stats ? formatCount(stats.predictions) : <>&mdash;</>}
          </p>
        </div>
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-500">Feedback</p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
            {stats ? formatCount(stats.feedback) : <>&mdash;</>}
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/admin/securities/13f"
          className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">13F Operations</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Monitor filing pipeline</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Review SEC discovery, queue health, failed filings, and backfill progress.
          </p>
        </Link>

        <Link
          href="/admin/securities/cusip-gaps"
          className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">CUSIP Gaps</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Improve ticker coverage</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Find unmapped 13F holdings by CUSIP, issuer, value, and filing context.
          </p>
        </Link>

        <Link
          href="/admin/institutions/digests"
          className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Institution Digests</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Generate in-app summaries</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Run dry previews, checkpoint live digest batches, and inspect saved activity snapshots.
          </p>
        </Link>

        <Link
          href="/admin/openai-usage"
          className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">OpenAI Usage</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Review API cost</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Inspect recent OpenAI calls, token counts, and estimated spend by workflow.
          </p>
        </Link>

        <Link
          href="/admin/company-graph"
          className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Company Graph</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Generate requested graphs</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Review queued tickers and generate focused SEC supply-chain graphs one at a time.
          </p>
        </Link>

        <Link
          href="/admin/ai-analyst"
          className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">AI Analyst</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Review generated drafts</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Approve or reject AI-generated calls before they appear in the public feed.
          </p>
        </Link>

        <Link
          href="/admin/feedback"
          className="rounded-2xl border border-white/15 bg-slate-900/70 p-5 transition hover:border-cyan-300/50 hover:bg-slate-900"
        >
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Feedback</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Review user submissions</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Read feature requests, bug reports, and suggestions submitted by users.
          </p>
        </Link>
      </section>

      <section className="mt-6 rounded-2xl border border-white/15 bg-slate-900/70 p-5">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Billing</p>
        <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Set user plan</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Look up a user by uid, email, or nickname and switch their plan between FREE and PRO for staging tests.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            type="text"
            value={planIdentifier}
            onChange={(event) => setPlanIdentifier(event.target.value)}
            placeholder="User id, email, or nickname"
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          <button
            type="button"
            onClick={() => void loadPlanLookup()}
            disabled={planLoading}
            className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
          >
            {planLoading ? "Loading..." : "Load user"}
          </button>
        </div>

        {planLookup ? (
          <div className="mt-4 grid gap-4 rounded-xl border border-cyan-500/20 bg-slate-950/45 p-4">
            <div className="grid gap-1 text-sm text-slate-300">
              <p className="text-slate-100">
                {planLookup.nickname ? `@${planLookup.nickname}` : planLookup.displayName ?? planLookup.id}
              </p>
              <p className="text-xs text-slate-400">UID: {planLookup.id}</p>
              {planLookup.email ? <p className="text-xs text-slate-400">Email: {planLookup.email}</p> : null}
              <p className="text-xs text-slate-400">
                Effective Pro access right now: {planLookup.canUsePro ? "Yes" : "No"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-400">Plan</span>
              <div className="inline-flex rounded-full border border-slate-700 bg-slate-900/70 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setPlanSelection("FREE")}
                  className={`rounded-full px-3 py-1.5 transition ${planSelection === "FREE" ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"}`}
                >
                  Free
                </button>
                <button
                  type="button"
                  onClick={() => setPlanSelection("PRO")}
                  className={`rounded-full px-3 py-1.5 transition ${planSelection === "PRO" ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"}`}
                >
                  Pro
                </button>
              </div>
              <button
                type="button"
                onClick={() => void savePlan()}
                disabled={planLoading || planSaving || planSelection === planLookup.plan}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
              >
                {planSaving ? "Saving..." : "Save plan"}
              </button>
            </div>
          </div>
        ) : null}

        {planMessage ? <p className="mt-3 text-sm text-slate-300">{planMessage}</p> : null}
      </section>
    </main>
  );
}

