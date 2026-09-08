"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { savedCompanyTickers } from "@/lib/industry-graph/saved-companies";
import { trackEvent } from "@/lib/analytics";

type State = { owner: string; tickers: string[]; status: "loading" | "ready" | "error"; busy: boolean; message: string };
export function useSavedMapCompanies() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const uid = user?.uid;
  const [state, setState] = useState<State | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    if (!uid) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setState({ owner: uid, tickers: [], status: "loading", busy: false, message: "" });
    void (async () => {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to load saved companies.");
      const response = await fetch("/api/industry-graph/saved", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Could not load your saved companies.");
      const payload = await response.json();
      if (!Array.isArray(payload.tickers)) throw new Error("Could not load your saved companies.");
      if (generation.current === current) setState({ owner: uid, tickers: savedCompanyTickers(payload.tickers), status: "ready", busy: false, message: "" });
    })().catch(() => {
      if (generation.current === current) setState({ owner: uid, tickers: [], status: "error", busy: false, message: "Could not load saved companies. Please retry." });
    }).finally(() => clearTimeout(timeout));
    return () => { generation.current = current + 1; controller.abort(); clearTimeout(timeout); };
  }, [uid, getIdToken, attempt]);

  const current = state?.owner === uid ? state : null;
  async function toggle(ticker: string) {
    if (!uid || !current || current.status !== "ready" || current.busy) return;
    const active = generation.current;
    const saved = !current.tickers.includes(ticker);
    setState({ ...current, busy: true, message: "" });
    trackEvent("graph_save_intent", { ticker, action: saved ? "save" : "remove" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in again to save this company.");
      const response = await fetch("/api/industry-graph/saved", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, saved }), signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not save this change. Please retry.");
      const payload = await response.json();
      if (!Array.isArray(payload.tickers)) throw new Error("Could not save this change. Please retry.");
      if (generation.current !== active) return;
      setState({ owner: uid, tickers: savedCompanyTickers(payload.tickers), status: "ready", busy: false, message: saved ? `${ticker} saved to your account.` : `${ticker} removed from saved companies.` });
      trackEvent("graph_save_complete", { ticker, action: saved ? "save" : "remove" });
    } catch {
      if (generation.current === active) {
        setState({ ...current, busy: false, message: "Could not confirm the change. Retry to confirm your choice." });
        trackEvent("graph_save_error", { ticker });
      }
    } finally { clearTimeout(timeout); }
  }
  return { signedIn: Boolean(uid), authLoading, tickers: current?.tickers ?? [], ready: current?.status === "ready", failed: current?.status === "error", busy: current?.busy ?? false, message: current?.message ?? "", retry: () => setAttempt((value) => value + 1), toggle };
}
