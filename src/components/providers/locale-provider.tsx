"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/locale";
import { applyPreferences } from "./preferences-context";
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
  const { active, saving, change } = useMarket();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = chinese ? "切换语言" : "Change language";
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  function select(language: Locale) {
    setOpen(false);
    trigger.current?.focus();
    if (language === (chinese ? 'zh-CN' : 'en')) return;
    if (active) void change({ language, market: "ALL" });
    else applyPreferences({ language, market: "ALL" });
  }
  return <div ref={container} className="relative shrink-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" disabled={saving} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18"/></svg>
    </button>
    {open && <div id={id} role="group" aria-label={chinese ? '语言选项' : 'Language options'} className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-white/15 bg-slate-950 p-1 shadow-xl">
      {([['en', 'English'], ['zh-CN', '简体中文']] as const).map(([language, name]) => {
        const current = language === (chinese ? 'zh-CN' : 'en');
        return <button key={language} type="button" lang={language} disabled={saving} aria-pressed={current} onClick={() => select(language)} className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-400">
          {name}{current && <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6"/></svg>}
        </button>;
      })}
    </div>}
  </div>;
}
