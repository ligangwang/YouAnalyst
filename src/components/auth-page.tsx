"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { safeAuthDestination } from "@/lib/auth-continuation";
import { trackEvent } from "@/lib/analytics";

export function AuthPage({ requestedNext }: { requestedNext?: string }) {
  const router = useRouter();
  const destination = safeAuthDestination(requestedNext);
  const { user, error, signInWithGoogle, signInWithEmail, createAccountWithEmail } = useAuth();
  const [isCreate, setIsCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function destinationForAuth(userId: string, shouldCompleteProfile: boolean) {
    return destination ?? (shouldCompleteProfile ? `/analysts/${userId}?onboarding=nickname` : "/predictions");
  }

  if (user) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-900/20 p-6 text-center">
          <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-emerald-100">Signed in</h1>
          <p className="text-sm text-emerald-50">Continue to the feed or create your next prediction.</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900"
            onClick={() => router.push(destination ?? "/predictions")}
          >
            {destination ? "Continue" : "Go to feed"}
          </button>
        </div>
      </main>
    );
  }

  async function submitEmail() {
    trackEvent("auth_start", { method: "email", action: isCreate ? "sign_up" : "login" });
    setSubmitting(true);
    setLocalError(null);

    try {
      const result = isCreate
        ? await createAccountWithEmail(email, password)
        : await signInWithEmail(email, password);

      trackEvent(isCreate ? "sign_up" : "login", { method: "email" });
      if (isCreate) {
        setIsCreate(false);
      }

      router.push(destinationForAuth(result.user.uid, result.shouldCompleteProfile));
    } catch (nextError) {
      trackEvent("auth_error", { method: "email" });
      setLocalError(nextError instanceof Error ? nextError.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-6 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">Sign in to YouAnalyst</h1>
        <p className="mb-6 text-sm text-slate-300">Use Google or email/password to create predictions and build a score.</p>

        <button
          type="button"
          onClick={() => {
            trackEvent("auth_start", { method: "google" });
            void signInWithGoogle()
              .then((result) => {
                trackEvent(result.shouldCompleteProfile ? "sign_up" : "login", { method: "google" });
                router.push(destinationForAuth(result.user.uid, result.shouldCompleteProfile));
              })
              .catch((error: unknown) => {
                const code = error && typeof error === "object" && "code" in error ? error.code : null;
                const canceled = code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
                trackEvent(canceled ? "auth_cancel" : "auth_error", { method: "google" });
              });
          }}
          className="mb-4 w-full rounded-xl border border-cyan-300/40 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20"
        >
          Continue with Google
        </button>

        <div className="mb-4 text-center text-xs uppercase tracking-[0.2em] text-slate-400">or</div>

        <div className="grid gap-3">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          <button
            type="button"
            onClick={() => void submitEmail()}
            disabled={submitting || !email || !password}
            className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-60"
          >
            {isCreate ? "Create account" : "Sign in"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsCreate((prev) => !prev)}
          className="mt-4 text-sm text-cyan-200 underline-offset-2 hover:underline"
        >
          {isCreate ? "Have an account? Sign in" : "Need an account? Create one"}
        </button>

        {localError || error ? <p className="mt-3 text-sm text-rose-300">{localError || error}</p> : null}
      </section>
    </main>
  );
}
