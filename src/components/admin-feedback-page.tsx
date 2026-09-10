"use client";

import { UiText } from "@/components/ui-text";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type FeedbackCategory = "FEATURE_REQUEST" | "BUG_REPORT" | "SUGGESTION";

type FeedbackSubmission = {
  id: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  contactEmail: string | null;
  status: string;
  source: string | null;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminStats = {
  users: number;
  predictions: number;
  feedback: number;
};

const categoryLabels: Record<FeedbackCategory, string> = {
  FEATURE_REQUEST: "Feature request",
  BUG_REPORT: "Bug report",
  SUGGESTION: "Suggestion",
};

function formatDate(value: string): string {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function submitterLabel(submission: FeedbackSubmission): string {
  return submission.userDisplayName || submission.userEmail || submission.contactEmail || "Anonymous";
}

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function countFromPayload(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AdminFeedbackPage() {
  const { user, loading, getIdToken } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [submissions, setSubmissions] = useState<FeedbackSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countLabel = useMemo(() => {
    if (submissions.length === 1) {
      return "1 submission";
    }

    return `${submissions.length} submissions`;
  }, [submissions.length]);

  useEffect(() => {
    if (loading) {
      return;
    }

    let cancelled = false;

    async function loadAdminData() {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      setLoadingSubmissions(true);
      setError(null);

      try {
        if (!user) {
          throw new Error("Sign in with an admin account to view feedback.");
        }

        const token = await getIdToken();

        if (!token) {
          throw new Error("Sign in with an admin account to view feedback.");
        }

        const headers = {
          authorization: `Bearer ${token}`,
        };
        const [statsResponse, feedbackResponse] = await Promise.all([
          fetch("/api/admin/stats", { headers }),
          fetch("/api/feedback", { headers }),
        ]);

        const statsPayload = (await statsResponse.json().catch(() => ({}))) as Partial<AdminStats> & {
          error?: string;
        };
        const feedbackPayload = (await feedbackResponse.json().catch(() => ({}))) as {
          submissions?: FeedbackSubmission[];
          error?: string;
        };

        if (!statsResponse.ok) {
          throw new Error(statsPayload.error ?? "Unable to load admin stats.");
        }

        if (!feedbackResponse.ok) {
          throw new Error(feedbackPayload.error ?? "Unable to load feedback.");
        }

        if (!cancelled) {
          setStats({
            users: countFromPayload(statsPayload.users),
            predictions: countFromPayload(statsPayload.predictions),
            feedback: countFromPayload(statsPayload.feedback),
          });
          setSubmissions(feedbackPayload.submissions ?? []);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load feedback.");
          setStats(null);
          setSubmissions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingSubmissions(false);
        }
      }
    }

    void loadAdminData();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, loading, user]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <p className="mb-3 text-sm font-medium text-cyan-200"><UiText text={"Admin"} /></p>

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-500"><UiText text={"Users"} /></p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
            {stats ? formatCount(stats.users) : <><UiText text={"&mdash;"} /></>}
          </p>
        </div>
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-500"><UiText text={"Predictions"} /></p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
            {stats ? formatCount(stats.predictions) : <><UiText text={"&mdash;"} /></>}
          </p>
        </div>
        <div className="rounded-xl border border-cyan-500/25 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-500"><UiText text={"Feedback"} /></p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
            {stats ? formatCount(stats.feedback) : <><UiText text={"&mdash;"} /></>}
          </p>
        </div>
      </section>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"Feedback submissions"} /></h1>
          <p className="mt-2 text-sm text-slate-300"><UiText text={"Review the latest notes sent from the public feedback page."} /></p>
        </div>
        <Link
          href="/feedback"
          className="w-fit rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/15"
        ><UiText text={"Submit feedback"} /></Link>
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 shadow-[0_8px_40px_rgba(8,47,73,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <p className="text-sm font-medium text-slate-200">{loadingSubmissions ? <UiText text={"Loading..."} /> : countLabel}</p>
          <p className="text-xs text-slate-500"><UiText text={"Latest 100"} /></p>
        </div>

        {error ? (
          <div className="px-5 py-8 text-sm text-rose-300">{<UiText text={error} />}</div>
        ) : loadingSubmissions ? (
          <div className="px-5 py-8 text-sm text-slate-300"><UiText text={"Loading feedback..."} /></div>
        ) : submissions.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-300"><UiText text={"No feedback has been submitted yet."} /></div>
        ) : (
          <div className="divide-y divide-white/10">
            {submissions.map((submission) => (
              <article key={submission.id} className="grid gap-4 px-5 py-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-100">
                        {<UiText text={categoryLabels[submission.category]} />}
                      </span>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
                        {<UiText text={submission.status} />}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold text-white">{submission.subject}</h2>
                    <p className="mt-1 text-xs text-slate-500">{submission.id}</p>
                  </div>
                  <time className="text-sm text-slate-400" dateTime={submission.createdAt}>
                    {formatDate(submission.createdAt)}
                  </time>
                </div>

                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{submission.message}</p>

                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-slate-500"><UiText text={"From"} /></dt>
                    <dd className="mt-1 text-slate-200">{submitterLabel(submission)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500"><UiText text={"Contact"} /></dt>
                    <dd className="mt-1 text-slate-200">{submission.contactEmail ?? <UiText text={"None"} />}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500"><UiText text={"User ID"} /></dt>
                    <dd className="mt-1 break-all text-slate-200">{submission.userId ?? <UiText text={"Anonymous"} />}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500"><UiText text={"User agent"} /></dt>
                    <dd className="mt-1 break-words text-slate-400">{submission.userAgent ?? <UiText text={"Unknown"} />}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
