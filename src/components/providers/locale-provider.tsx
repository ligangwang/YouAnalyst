"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@/lib/locale";
import { useMarket } from "./preferences-context";

const LocaleContext = createContext<Locale>("en");
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const locale = useContext(LocaleContext);
  return { locale, chinese: locale === "zh-CN", text: (en: string, zh: string) => locale === "zh-CN" ? zh : en };
}
export function LanguageSwitch() {
  const { chinese } = useLocale();
  const { active, market, saving, change } = useMarket();
  return <button type="button" disabled={saving} className="shrink-0 rounded-full border border-white/15 px-3 py-2 text-xs text-slate-300 hover:bg-white/10" aria-label={chinese ? "Switch to English" : "切换为简体中文"} onClick={() => {
    if (active) void change({ language: chinese ? "en" : "zh-CN", market });
    else { const url = new URL(window.location.href); url.searchParams.set("lang", chinese ? "en" : "zh-CN"); window.location.assign(url); }
  }}>{chinese ? "EN" : "中文"}</button>;
}
