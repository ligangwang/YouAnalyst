"use client";
import { useRouter } from "next/navigation";
import { pathLocale } from "@/lib/ui/i18n/urls";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { useLocale } from "./locale-provider";
import { DISPLAY_STORAGE_KEY, THEME_MODE_STORAGE_KEY, parseThemeMode, resolveTheme, parsePreferences, type ThemeMode, type DisplayPreferences, type PriceColorConvention, type UiTheme } from "@/lib/preferences";
import { MarketContext, applyPreferences } from "./preferences-context";
export { useMarket } from "./preferences-context";

export function applyDisplayAppearance(preferences: DisplayPreferences, owner: string | null = null) {
  document.documentElement.dataset.theme = preferences.theme ?? "dark";
  document.documentElement.dataset.priceColors = preferences.priceColors ?? "green-up";
  try { localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ ...preferences, owner })); } catch { /* Storage can be disabled. */ }
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading, getIdToken } = useAuth();
  const { locale } = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const mode = useRef<ThemeMode>("system");
  const [appearance, setAppearance] = useState<{theme: UiTheme; priceColors: PriceColorConvention}>({ theme: "dark", priceColors: "green-up" });
  const revision = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    const loadRevision = revision.current;
    const adopt = (preferences: DisplayPreferences, selectedMode: ThemeMode) => {
      mode.current = selectedMode; setThemeMode(selectedMode);
      if (!user && selectedMode === 'system') { try { localStorage.setItem(THEME_MODE_STORAGE_KEY, selectedMode); } catch {} }
      const theme = resolveTheme(selectedMode, matchMedia('(prefers-color-scheme: light)').matches);
      applyDisplayAppearance({ ...preferences, theme }, user?.uid ?? null);
      setAppearance({ theme, priceColors: preferences.priceColors ?? "green-up" });
    };
    void (async () => {
      setRestoring(true);
      try {
        try {
          const stored = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) ?? "null");
          const cached = stored?.owner === (user?.uid ?? null) ? parsePreferences(stored) : null;
          const selectedMode = parseThemeMode(localStorage.getItem(THEME_MODE_STORAGE_KEY)) ?? cached?.theme ?? "system";
          if (revision.current === loadRevision && !controller.signal.aborted) adopt(cached ?? { language: locale, market: "ALL" }, selectedMode);
        } catch { adopt({ language: locale, market: "ALL" }, "system"); }
        if (!user) return;
        try {
          const token = await getIdToken();
          if (!token || controller.signal.aborted) return;
          const response = await fetch("/api/preferences", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
          if (!response.ok) return;
          const preferences = parsePreferences((await response.json()).preferences);
          if (!controller.signal.aborted && revision.current === loadRevision && preferences) {
            let selectedMode: ThemeMode = preferences.theme;
            try { selectedMode = parseThemeMode(localStorage.getItem(THEME_MODE_STORAGE_KEY)) ?? preferences.theme; } catch {}
            adopt(preferences, selectedMode);
            // A localized URL controls language, but never suppresses account appearance settings.
            const params = new URLSearchParams(window.location.search);
            if (!pathLocale(window.location.pathname) && !params.has("lang") && preferences.language !== locale) applyPreferences({ ...preferences, market: "ALL" });
          }
        } catch { /* Keep the current visitor preference if the account is unavailable. */ }
      } finally { if (!controller.signal.aborted) setRestoring(false); }
    })();
    return () => controller.abort();
  }, [user, loading, getIdToken, locale]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const update = () => {
      if (mode.current !== 'system') return;
      const theme = resolveTheme('system', media.matches);
      document.documentElement.dataset.theme = theme;
      setAppearance(current => ({ ...current, theme }));
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function changeTheme(selectedMode: ThemeMode) {
    // Device theme mode is local; the account API retains its dark/light contract.
    revision.current += 1;
    mode.current = selectedMode; setThemeMode(selectedMode);
    const theme = resolveTheme(selectedMode, matchMedia('(prefers-color-scheme: light)').matches);
    applyDisplayAppearance({ language: locale, market: 'ALL', priceColors: appearance.priceColors, theme }, user?.uid ?? null);
    try { localStorage.setItem(THEME_MODE_STORAGE_KEY, selectedMode); } catch {}
    setAppearance(current => ({ ...current, theme }));
  }
  async function change(input: DisplayPreferences) {
    if (savingRef.current || loading || restoring) return;
    const preferences = parsePreferences({ ...appearance, ...input });
    if (!preferences) return;
    savingRef.current = true;
    revision.current += 1;
    setSaving(true); setError(false);
    try {
      if (user) {
        const token = await getIdToken();
        if (!token) throw new Error("Authentication unavailable");
        const response = await fetch("/api/preferences", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(preferences) });
        if (!response.ok) throw new Error("Save failed");
      }
      applyDisplayAppearance(preferences, user?.uid ?? null);
      if (input.theme) { mode.current = input.theme; setThemeMode(input.theme); try { localStorage.setItem(THEME_MODE_STORAGE_KEY, input.theme); } catch {} }
      setAppearance({ theme: preferences.theme, priceColors: preferences.priceColors });
      if (preferences.language !== locale) applyPreferences(preferences, url => router.replace(url, { scroll: false }));
    } catch { setError(true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <MarketContext.Provider value={{ active: true, market: "ALL", ...appearance, themeMode, changeTheme, saving: saving || loading || restoring, error, change }}>{children}</MarketContext.Provider>;
}
