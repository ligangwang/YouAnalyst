"use client";
import { useLocale } from "./providers/locale-provider";
import { useMarket } from "./providers/market-provider";
import { parseMarket } from "@/lib/preferences";

export function MarketSwitch() {
  const { text, locale } = useLocale();
  const { market, saving, change } = useMarket();
  return <select aria-label={text("Market", "市场")} value={market} disabled={saving} onChange={event => { const next = parseMarket(event.target.value); if (next) void change({ language: locale, market: next }); }} className="w-[76px] sm:w-auto sm:max-w-24 rounded-full border border-white/15 bg-slate-950 px-2 py-2 text-xs text-slate-300">
    <option value="US">{text("US", "美股")}</option><option value="CN_A">{text("A-shares", "A 股")}</option><option value="ALL">{text("All markets", "全部市场")}</option>
  </select>;
}
export function PreferenceError() {
  const { error } = useMarket(); const { text } = useLocale();
  return error ? <p role="alert" className="mx-auto max-w-6xl px-4 pb-2 text-xs text-rose-300">{text("Could not save your preferences. Please try the selection again.", "偏好保存失败，请重新选择。")}</p> : null;
}
export function DisplayPreferencesPanel() {
  const { text, locale } = useLocale(); const { market, saving, change } = useMarket();
  return <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
    <h2 className="text-lg font-semibold">{text("Language and markets", "语言与市场")}</h2>
    <p className="mt-2 text-sm text-slate-400">{text("Choose your interface language separately from the markets you follow. Saved to your account.", "界面语言与关注市场分别设置，偏好保存到你的账号。")}</p>
    <div className="mt-4 flex flex-wrap items-center gap-6">
      <label className="flex items-center gap-3 text-sm">{text("Interface language", "界面语言")}<select className="rounded-lg border border-white/15 bg-slate-950 p-2" value={locale} disabled={saving} onChange={event => void change({ language: event.target.value === "zh-CN" ? "zh-CN" : "en", market })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
      <label className="flex items-center gap-3 text-sm">{text("Markets", "关注市场")}<MarketSwitch /></label>
    </div>
    <PreferenceError />
  </section>;
}
