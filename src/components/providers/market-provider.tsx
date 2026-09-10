"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { useLocale } from "./locale-provider";
import { parsePreferences, type DisplayPreferences, type MarketSelection } from "@/lib/preferences";
import { MarketContext, applyPreferences } from "./preferences-context";
export { useMarket } from "./preferences-context";
export function MarketProvider({ market, children }: { market: MarketSelection; children: ReactNode }) {
  const { user, getIdToken } = useAuth();
  const { locale } = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("lang") || params.has("market")) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token || controller.signal.aborted) return;
        const response = await fetch("/api/preferences", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const preferences = parsePreferences((await response.json()).preferences);
        if (!controller.signal.aborted && preferences && (preferences.language !== locale || preferences.market !== market)) applyPreferences(preferences);
      } catch { /* Keep the current visitor preference if the account is unavailable. */ }
    })();
    return () => controller.abort();
  }, [user, getIdToken, locale, market]);
  async function change(preferences: DisplayPreferences) {
    if (saving) return;
    setSaving(true); setError(false);
    try {
      if (user) {
        const token = await getIdToken();
        if (!token) throw new Error("Authentication unavailable");
        const response = await fetch("/api/preferences", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(preferences) });
        if (!response.ok) throw new Error("Save failed");
      }
      applyPreferences(preferences);
    } catch { setError(true); setSaving(false); }
  }
  return <MarketContext.Provider value={{ active: true, market, saving, error, change }}>{children}</MarketContext.Provider>;
}
