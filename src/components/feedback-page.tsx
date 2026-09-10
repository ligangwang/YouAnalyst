"use client";

import { UiText, useUiText } from "@/components/ui-text";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type FeedbackCategory = "FEATURE_REQUEST" | "BUG_REPORT" | "SUGGESTION";

const categoryOptions: Array<{ value: FeedbackCategory; label: string; help: string }> = [
  {
    value: "FEATURE_REQUEST",
    label: "Feature request",
    help: "Something that would make YouAnalyst more useful.",
  },
  {
    value: "BUG_REPORT",
    label: "Bug report",
    help: "Something broken, confusing, or not working as expected.",
  },
  {
    value: "SUGGESTION",
    label: "Suggestion",
    help: "A sharper workflow, clearer copy, or anything else on your mind.",
  },
];

function queryParam(searchParams: URLSearchParams, name: string, maxLength: number): string {
  return (searchParams.get(name) ?? "").slice(0, maxLength);
}

function feedbackCategory(value: string): FeedbackCategory {
  return value === "BUG_REPORT" || value === "SUGGESTION" || value === "FEATURE_REQUEST"
    ? value
    : "FEATURE_REQUEST";
}

export function FeedbackPage() {
  const ui = useUiText();
  const { user, loading, getIdToken } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>("FEATURE_REQUEST");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const resolvedContactEmail = useMemo(() => contactEmail.trim() || user?.email || "", [contactEmail, user?.email]);
  const canSubmit = subject.trim().length >= 4 && message.trim().length >= 10 && !submitting;

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const nextCategory = searchParams.get("category");
    const nextSubject = queryParam(searchParams, "subject", 120);
    const nextMessage = queryParam(searchParams, "message", 4000);

    if (nextCategory) {
      setCategory(feedbackCategory(nextCategory));
    }
    if (nextSubject) {
      setSubject(nextSubject);
    }
    if (nextMessage) {
      setMessage(nextMessage);
    }
  }, []);

  async function submitFeedback() {
    if (!canSubmit) {
      setError("Add a short subject and a little more detail before sending.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getIdToken();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };

      if (token) {
        headers.authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category,
          subject,
          message,
          contactEmail: resolvedContactEmail || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to send feedback right now.");
      }

      setSubmitted(true);
      setSubject("");
      setMessage("");
      setContactEmail("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send feedback right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-6 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <p className="mb-2 text-sm font-medium text-cyan-200"><UiText text={"Feedback"} /></p>
        <h1 className="mb-3 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"Help shape YouAnalyst"} /></h1>
        <p className="mb-6 text-sm leading-6 text-slate-300"><UiText text={"Send a feature request, report a bug, or share a suggestion. The more specific you are, the easier it is to act on it."} /></p>

        {submitted ? (
          <div className="mb-6 rounded-xl border border-emerald-400/30 bg-emerald-900/20 p-4 text-sm text-emerald-50"><UiText text={"Thanks for sending this. Your note is in the queue."} /></div>
        ) : null}

        <div className="grid gap-5">
          <div className="grid gap-2">
            <span className="text-sm text-slate-200"><UiText text={"What are you sending?"} /></span>
            <div className="grid gap-2 sm:grid-cols-3">
              {categoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCategory(option.value)}
                  className={`rounded-xl border p-3 text-left transition ${
                    category === option.value
                      ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-50"
                      : "border-white/15 bg-slate-950/40 text-slate-200 hover:border-cyan-300/40"
                  }`}
                >
                  <span className="block text-sm font-semibold">{<UiText text={option.label} />}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">{<UiText text={option.help} />}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-sm text-slate-200"><UiText text={"Subject"} /></span>
            <input
              value={subject}
              maxLength={120}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={ui("Add portfolio watchlists")}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 placeholder:text-slate-500 focus:ring"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-slate-200"><UiText text={"Details"} /></span>
            <textarea
              value={message}
              maxLength={4000}
              rows={8}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={ui("What happened, what did you expect, or what would you like to see?")}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 placeholder:text-slate-500 focus:ring"
            />
            <span className="text-xs text-slate-500">{message.length}/4000</span>
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-slate-200"><UiText text={"Contact email"} /></span>
            <input
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder={loading ? "Loading account..." : user?.email ?? "you@example.com"}
              className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 placeholder:text-slate-500 focus:ring"
            />
            <span className="text-xs text-slate-500"><UiText text={"Optional, but helpful if follow-up would make sense."} /></span>
          </label>

          <button
            type="button"
            onClick={() => void submitFeedback()}
            disabled={!canSubmit}
            className="w-full rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-60 sm:w-fit"
          >
            {submitting ? <UiText text={"Sending..."} /> : <UiText text={"Send feedback"} />}
          </button>

          {error ? <p className="text-sm text-rose-300">{<UiText text={error} />}</p> : null}
        </div>
      </section>
    </main>
  );
}
