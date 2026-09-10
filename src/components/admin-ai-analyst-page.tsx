"use client";

import { UiText } from "@/components/ui-text";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/auth-provider";
import { formatTickerSymbol } from "@/components/prediction-ui";

type DraftStatus = "DRAFT" | "SKIPPED" | "REJECTED" | "PUBLISHED";

type AiPredictionDraft = {
  id: string;
  status: DraftStatus;
  action: "NO_CALL" | "CREATE_CALL";
  ticker: string;
  direction: "UP" | "DOWN" | null;
  confidence: number | null;
  catalyst: string | null;
  thesisTitle: string | null;
  thesis: string | null;
  signals?: string[];
  risks?: string[];
  rationale?: string | null;
  createdAt: string;
  runDate?: string;
  publishedPredictionId?: string | null;
  review?: {
    action?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reason?: string | null;
  } | null;
  validation?: {
    eligibleTicker?: boolean;
    meetsConfidenceThreshold?: boolean;
    hasRequiredFields?: boolean;
  } | null;
};

type AdminStats = {
  users: number;
  predictions: number;
  feedback: number;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
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

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function countFromPayload(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function confidenceText(value: number | null): string {
  if (typeof value !== "number") {
    return "N/A";
  }

  return `${Math.round(value * 100)}%`;
}

function toneForStatus(status: DraftStatus): string {
  if (status === "PUBLISHED") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  }
  if (status === "REJECTED") {
    return "border-rose-400/30 bg-rose-500/10 text-rose-100";
  }
  if (status === "SKIPPED") {
    return "border-white/15 bg-white/5 text-slate-200";
  }
  return "border-cyan-400/30 bg-cyan-500/10 text-cyan-100";
}

export function AdminAiAnalystPage() {
  const { user, loading, getIdToken } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [drafts, setDrafts] = useState<AiPredictionDraft[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [runCreatedAt, setRunCreatedAt] = useState<string | null>(null);

  const countLabel = useMemo(() => {
    if (drafts.length === 1) {
      return "1 draft";
    }
    return `${drafts.length} drafts`;
  }, [drafts.length]);

  useEffect(() => {
    if (loading) {
      return;
    }

    let cancelled = false;

    async function loadAdminData() {
      if (cancelled) {
        return;
      }

      setLoadingData(true);
      setError(null);

      try {
        if (!user) {
          throw new Error("Sign in with an admin account to view AI analyst drafts.");
        }

        const token = await getIdToken();
        if (!token) {
          throw new Error("Sign in with an admin account to view AI analyst drafts.");
        }

        const headers = {
          authorization: `Bearer ${token}`,
        };

        const [statsResponse, draftsResponse] = await Promise.all([
          fetch("/api/admin/stats", { headers }),
          fetch("/api/admin/ai-analyst/drafts?limit=100", { headers }),
        ]);

        const statsPayload = (await statsResponse.json().catch(() => ({}))) as Partial<AdminStats> & {
          error?: string;
        };
        const draftsPayload = (await draftsResponse.json().catch(() => ({}))) as {
          drafts?: AiPredictionDraft[];
          runCreatedAt?: string | null;
          error?: string;
        };

        if (!statsResponse.ok) {
          throw new Error(statsPayload.error ?? "Unable to load admin stats.");
        }

        if (!draftsResponse.ok) {
          throw new Error(draftsPayload.error ?? "Unable to load AI analyst drafts.");
        }

        if (!cancelled) {
          setStats({
            users: countFromPayload(statsPayload.users),
            predictions: countFromPayload(statsPayload.predictions),
            feedback: countFromPayload(statsPayload.feedback),
          });
          setDrafts(draftsPayload.drafts ?? []);
          setRunCreatedAt(draftsPayload.runCreatedAt ?? null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load AI analyst drafts.");
          setStats(null);
          setDrafts([]);
          setRunCreatedAt(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    }

    void loadAdminData();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, loading, user]);

  async function mutateDraft(draftId: string, action: "approve" | "reject") {
    setPendingDraftId(draftId);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in with an admin account to review AI drafts.");
      }

      const response = await fetch(`/api/admin/ai-analyst/drafts/${draftId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        status?: DraftStatus;
        predictionId?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update AI draft.");
      }

      setDrafts((prev) =>
        prev.map((draft) =>
          draft.id === draftId
            ? {
                ...draft,
                status: payload.status ?? draft.status,
                publishedPredictionId: payload.predictionId ?? draft.publishedPredictionId ?? null,
                review: {
                  ...(draft.review ?? {}),
                  action: action === "approve" ? "APPROVED" : "REJECTED",
                },
              }
            : draft,
        ),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update AI draft.");
    } finally {
      setPendingDraftId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
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
          <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"AI analyst drafts"} /></h1>
          <p className="mt-2 text-sm text-slate-300"><UiText text={"Review generated AI analyst calls before they are published to the feed."} /></p>
        </div>
        <Link
          href="/how-it-works"
          className="w-fit rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/15"
        ><UiText text={"View methodology"} /></Link>
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 shadow-[0_8px_40px_rgba(8,47,73,0.35)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <p className="text-sm font-medium text-slate-200">{loadingData ? <UiText text={"Loading..."} /> : countLabel}</p>
          <p className="text-xs text-slate-500">
            {runCreatedAt ? <UiText text={`Latest run: ${formatDateTime(runCreatedAt)}`} /> : <UiText text={"Latest run"} />}
          </p>
        </div>

        {error ? (
          <div className="px-5 py-8 text-sm text-rose-300">{<UiText text={error} />}</div>
        ) : loadingData ? (
          <div className="px-5 py-8 text-sm text-slate-300"><UiText text={"Loading AI analyst drafts..."} /></div>
        ) : drafts.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-300"><UiText text={"No AI analyst drafts yet."} /></div>
        ) : (
          <div className="divide-y divide-white/10">
            {drafts.map((draft) => (
              <article key={draft.id} className="grid gap-4 px-5 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneForStatus(draft.status)}`}>
                        {<UiText text={draft.status} />}
                      </span>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
                        {<UiText text={draft.action} />}
                      </span>
                      {draft.direction ? (
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
                          {<UiText text={draft.direction} />}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="text-lg font-semibold text-white">
                      {formatTickerSymbol(draft.ticker)} {draft.thesisTitle ? `- ${draft.thesisTitle}` : ""}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">{draft.id}</p>
                  </div>
                  <div className="text-sm text-slate-400">
                    <p><UiText text={"Run date: "} />{draft.runDate ?? <UiText text={"Unknown"} />}</p>
                    <p><UiText text={"Created: "} />{formatDateTime(draft.createdAt)}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3">
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Confidence"} /></p>
                    <p className="mt-1 text-sm font-semibold text-cyan-100">{<UiText text={confidenceText(draft.confidence)} />}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3">
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Catalyst"} /></p>
                    <p className="mt-1 text-sm text-slate-200">{draft.catalyst ?? <UiText text={"None"} />}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3">
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Validation"} /></p>
                    <p className="mt-1 text-sm text-slate-200">
                      {draft.validation?.eligibleTicker === false ? <UiText text={"Outside universe"} /> : <UiText text={"Eligible ticker"} />}
                    </p>
                    <p className="text-xs text-slate-400">
                      {draft.validation?.meetsConfidenceThreshold === false ? <UiText text={"Below threshold"} /> : <UiText text={"Confidence ok"} />}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3">
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Publish"} /></p>
                    {draft.publishedPredictionId ? (
                      <Link
                        href={`/predictions/${draft.publishedPredictionId}`}
                        className="mt-1 inline-block text-sm font-medium text-cyan-200 hover:text-cyan-100"
                      ><UiText text={"View published prediction"} /></Link>
                    ) : (
                      <p className="mt-1 text-sm text-slate-300"><UiText text={"Not published"} /></p>
                    )}
                  </div>
                </div>

                {draft.thesis ? (
                  <div>
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Thesis"} /></p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{draft.thesis}</p>
                  </div>
                ) : null}

                {draft.rationale ? (
                  <div>
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Rationale"} /></p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{draft.rationale}</p>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Signals"} /></p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(draft.signals ?? []).length > 0 ? (
                        draft.signals?.map((signal) => (
                          <span
                            key={signal}
                            className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-100"
                          >
                            {signal}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400"><UiText text={"None"} /></span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-500"><UiText text={"Risks"} /></p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(draft.risks ?? []).length > 0 ? (
                        draft.risks?.map((risk) => (
                          <span
                            key={risk}
                            className="rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-100"
                          >
                            {risk}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400"><UiText text={"None"} /></span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void mutateDraft(draft.id, "approve")}
                    disabled={pendingDraftId === draft.id || draft.status !== "DRAFT"}
                    className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingDraftId === draft.id ? <UiText text={"Saving..."} /> : <UiText text={"Approve & publish"} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void mutateDraft(draft.id, "reject")}
                    disabled={pendingDraftId === draft.id || draft.status !== "DRAFT"}
                    className="rounded-lg border border-rose-400/35 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  ><UiText text={"Reject"} /></button>
                  {draft.review?.action ? (
                    <p className="text-xs text-slate-500"><UiText text={"Last review: "} />{draft.review.action} {draft.review.reviewedAt ? <UiText text={`on ${formatDateTime(draft.review.reviewedAt)}`} /> : ""}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

