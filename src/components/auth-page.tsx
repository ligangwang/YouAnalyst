"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { safeAuthDestination } from "@/lib/auth-continuation";
import { trackEvent } from "@/lib/analytics";
import { mapAuthCompany } from "@/lib/industry-graph/saved-companies";

export function AuthPage({ requestedNext, initialCreate = false }: { requestedNext?: string; initialCreate?: boolean }) {
  const router = useRouter();
  const destination = safeAuthDestination(requestedNext);
  const mapCompany = mapAuthCompany(destination);
  const { user, loading, error, signInWithGoogle, signInWithEmail, createAccountWithEmail } = useAuth();
  const [isCreate, setIsCreate] = useState(initialCreate);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const viewed = useRef(false);
  const entryPoint = mapCompany ? "map_save" : destination?.startsWith("/predictions/new") ? "prediction" : "general";

  useEffect(() => {
    if (loading || user || viewed.current) return;
    viewed.current = true;
    trackEvent("auth_view", { entry_point: entryPoint, action: initialCreate ? "sign_up" : "login" });
  }, [loading, user, entryPoint, initialCreate]);

  function destinationForAuth(userId: string, shouldCompleteProfile: boolean) {
    return destination ?? (shouldCompleteProfile ? `/analysts/${userId}?onboarding=nickname` : "/predictions");
  }

  if (user) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-900/20 p-6 text-center">
          <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-emerald-100">Signed in</h1>
          <p className="text-sm text-emerald-50">{mapCompany ? `Return to the map and select Save ${mapCompany} to keep it in your account.` : "Continue to the feed or create your next prediction."}</p>
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
    trackEvent("auth_start", { method: "email", action: isCreate ? "sign_up" : "login", entry_point: entryPoint });
    setSubmitting(true);
    setLocalError(null);

    try {
      const result = isCreate
        ? await createAccountWithEmail(email, password)
        : await signInWithEmail(email, password);

      trackEvent(isCreate ? "sign_up" : "login", { method: "email", entry_point: entryPoint });
      if (isCreate) {
        setIsCreate(false);
      }

      router.push(destinationForAuth(result.user.uid, result.shouldCompleteProfile));
    } catch (nextError) {
      trackEvent("auth_error", { method: "email", entry_point: entryPoint });
      setLocalError(nextError instanceof Error ? nextError.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-6 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{mapCompany ? `Keep ${mapCompany} on your map` : isCreate ? "Create your YouAnalyst account" : "Sign in to YouAnalyst"}</h1>
        <p className="mb-6 text-sm text-slate-300">{mapCompany ? `Create an account or sign in to keep a personal list of companies. You’ll return to ${mapCompany}; select Save ${mapCompany} to add it.` : entryPoint === "prediction" ? "Keep your investment thesis and track how your predictions perform." : "Save companies from the AI industry map and return to their filing connections. You can also publish predictions and track your results."}</p>

        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setSubmitting(true);
            setLocalError(null);
            trackEvent("auth_start", { method: "google", entry_point: entryPoint });
            void signInWithGoogle()
              .then((result) => {
                trackEvent(result.shouldCompleteProfile ? "sign_up" : "login", { method: "google", entry_point: entryPoint });
                router.push(destinationForAuth(result.user.uid, result.shouldCompleteProfile));
              })
              .catch((error: unknown) => {
                const code = error && typeof error === "object" && "code" in error ? error.code : null;
                const canceled = code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
                trackEvent(canceled ? "auth_cancel" : "auth_error", { method: "google", entry_point: entryPoint });
                if (!canceled) setLocalError(error instanceof Error ? error.message : "Google sign-in failed. Please try again.");
              }).finally(() => setSubmitting(false));
          }}
          className="mb-4 w-full rounded-xl border border-cyan-300/40 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20"
        >
          Continue with Google
        </button>

        <div className="mb-4 text-center text-xs uppercase tracking-[0.2em] text-slate-400">or</div>

        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && email && password) void submitEmail();
        }}>
          <input
            type="email"
            aria-label="Email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          <input
            type="password"
            aria-label="Password"
            autoComplete={isCreate ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            minLength={isCreate ? 6 : undefined}
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-60"
          >
            {isCreate ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          disabled={submitting}
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
