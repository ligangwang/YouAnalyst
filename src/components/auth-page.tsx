"use client";

import { useLocale } from "./providers/locale-provider";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { safeAuthDestination } from "@/lib/auth-continuation";
import { trackEvent } from "@/lib/analytics";
import { mapAuthCompany } from "@/lib/industry-graph/saved-companies";
import { saveCompanyToAccount } from "@/lib/save-company";

const authChinese: Record<string, string> = {"Signed in":"已登录","Continue to your research.":"继续你的研究。","Saving…":"保存中…","Continue":"继续","Go to feed":"查看动态","Create your YouAnalyst account":"创建 YouAnalyst 账号","Sign in to YouAnalyst":"登录 YouAnalyst","Turn your research into a record you can revisit. Keep bullish and bearish calls in watchlists and see how prices move after each call.":"将研究化为可以回顾的记录。在自选股中保存看多或看空观点，观察发布后的价格变化。","Your first watchlist is ready automatically.":"首个自选股列表将自动创建。","Your company and direction will carry through. Review your call before publishing; creating an account does not publish it.":"公司与方向将自动保留。请在发布前确认观点；注册账号不会自动发布。","Choose a company, pick Bullish or Bearish, and confirm your call. Add your reasoning whenever you have something to say.":"选择公司，点击看多或看空，再确认观点。随时补充你的理由。","Continue with Google":"使用 Google 继续","or":"或","Email":"邮箱","Password":"密码","Use at least 6 characters.":"至少使用 6 个字符。","Create account":"创建账号","Sign in":"登录","Have an account? Sign in":"已有账号？登录","Need an account? Create one":"还没有账号？立即注册"};

export function AuthPage({ requestedNext, initialCreate = false }: { requestedNext?: string; initialCreate?: boolean }) {
  const { chinese } = useLocale();
  const t = (value: string) => chinese ? authChinese[value] ?? value : value;
  const router = useRouter();
  const destination = safeAuthDestination(requestedNext);
  const mapCompany = mapAuthCompany(destination);
  const callUrl = destination ? new URL(destination, "https://youanalyst.invalid") : null;
  const callTicker = callUrl?.pathname === "/predictions/new" ? callUrl.searchParams.get("ticker")?.toUpperCase() : null;
  const callDirection = callUrl?.searchParams.get("direction");
  const callOutlook = callTicker && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(callTicker) && (callDirection === "UP" || callDirection === "DOWN")
    ? `${callDirection === "UP" ? "bullish" : "bearish"} view on ${callTicker}` : null;
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

  async function finishAuth(account: { uid: string; getIdToken: () => Promise<string> }, shouldCompleteProfile = false) {
    if (mapCompany) {
      try {
        await saveCompanyToAccount(mapCompany, () => account.getIdToken());
        trackEvent("graph_save_complete", { ticker: mapCompany, action: "save", entry_point: "map_save" });
      } catch {
        setLocalError(`You are signed in, but saving ${mapCompany} could not be confirmed. Retry below.`);
        trackEvent("graph_save_error", { ticker: mapCompany });
        return;
      }
    }
    router.push(destinationForAuth(account.uid, shouldCompleteProfile));
  }

  if (user) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-900/20 p-6 text-center">
          <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-emerald-100">{t("Signed in")}</h1>
          <p className="text-sm text-emerald-50">{mapCompany ? `Save ${mapCompany} to your account and return to its connections.` : t("Continue to your research.")}</p>
          {localError ? <p role="alert" className="mt-3 text-sm text-rose-200">{localError}</p> : null}
          <button
            type="button"
            className="mt-4 rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900"
            disabled={submitting}
            onClick={() => { setSubmitting(true); setLocalError(null); void finishAuth(user).finally(() => setSubmitting(false)); }}
          >
            {submitting ? t("Saving…") : mapCompany ? `Save ${mapCompany} and continue` : destination ? t("Continue") : t("Go to feed")}
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

      await finishAuth(result.user, result.shouldCompleteProfile);
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
        <h1 className="mb-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{mapCompany ? `Keep ${mapCompany} on your map` : callOutlook ? `Track your ${callOutlook}` : isCreate ? t("Create your YouAnalyst account") : t("Sign in to YouAnalyst")}</h1>
        <p className="mb-4 text-sm text-slate-300">{mapCompany ? `Create an account or sign in to save ${mapCompany}. Then return directly to its connections.` : t("Turn your research into a record you can revisit. Keep bullish and bearish calls in watchlists and see how prices move after each call.")}</p>
        {!mapCompany && <div className="mb-6 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-slate-300">
          <p className="font-medium text-cyan-100">{t("Your first watchlist is ready automatically.")}</p>
          <p className="mt-2">{callOutlook ? t("Your company and direction will carry through. Review your call before publishing; creating an account does not publish it.") : t("Choose a company, pick Bullish or Bearish, and confirm your call. Add your reasoning whenever you have something to say.")}</p>
        </div>}

        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setSubmitting(true);
            setLocalError(null);
            trackEvent("auth_start", { method: "google", entry_point: entryPoint });
            void signInWithGoogle()
              .then(async (result) => {
                trackEvent(result.shouldCompleteProfile ? "sign_up" : "login", { method: "google", entry_point: entryPoint });
                await finishAuth(result.user, result.shouldCompleteProfile);
              })
              .catch((error: unknown) => {
                const code = error && typeof error === "object" && "code" in error ? error.code : null;
                const canceled = code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
                trackEvent(canceled ? "auth_cancel" : "auth_error", { method: "google", entry_point: entryPoint });
                if (!canceled) setLocalError(error instanceof Error ? error.message : "Google sign-in failed. Please try again.");
              }).finally(() => setSubmitting(false));
          }}
          className="mb-4 w-full rounded-xl border border-cyan-300/40 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20"
        >{t("Continue with Google")}</button>

        <div className="mb-4 text-center text-xs uppercase tracking-[0.2em] text-slate-400">{t("or")}</div>

        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && email && password) void submitEmail();
        }}>
          <label htmlFor="auth-email" className="text-sm text-slate-200">{t("Email")}</label>
          <input
            id="auth-email"
            type="email"
            aria-label={t("Email")}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          <label htmlFor="auth-password" className="text-sm text-slate-200">{t("Password")}</label>
          <input
            id="auth-password"
            type="password"
            aria-label={t("Password")}
            autoComplete={isCreate ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("Password")}
            required
            minLength={isCreate ? 6 : undefined}
            aria-describedby={isCreate ? "password-help" : undefined}
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
          {isCreate && <p id="password-help" className="text-xs text-slate-400">{t("Use at least 6 characters.")}</p>}
          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-60"
          >
            {isCreate ? t("Create account") : t("Sign in")}
          </button>
        </form>

        <button
          type="button"
          disabled={submitting}
          onClick={() => setIsCreate((prev) => !prev)}
          className="mt-4 text-sm text-cyan-200 underline-offset-2 hover:underline"
        >
          {isCreate ? t("Have an account? Sign in") : t("Need an account? Create one")}
        </button>

        {localError || error ? <p className="mt-3 text-sm text-rose-300">{localError || error}</p> : null}
      </section>
    </main>
  );
}
