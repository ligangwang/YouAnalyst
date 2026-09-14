"use client";
import { useLocale } from "./providers/locale-provider";
import { useMarket } from "./providers/market-provider";
export function PreferenceError() {
  const { error } = useMarket(); const { text } = useLocale();
  return error ? <p role="alert" className="mx-auto max-w-6xl px-4 pb-2 text-xs text-rose-300">{text("Could not save your preferences. Please try the selection again.", "偏好保存失败，请重新选择。")}</p> : null;
}
export function DisplayPreferencesPanel() {
  const { text, locale } = useLocale(); const { saving, change } = useMarket();
  return <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
    <h2 className="text-lg font-semibold">{text("Language", "语言")}</h2>
    <p className="mt-2 text-sm text-slate-400">{text("Choose your interface language. Saved to your account.", "选择界面语言，偏好保存到你的账号。")}</p>
    <div className="mt-4 flex flex-wrap items-center gap-6">
      <label className="flex items-center gap-3 text-sm">{text("Interface language", "界面语言")}<select className="rounded-lg border border-white/15 bg-slate-950 p-2" value={locale} disabled={saving} onChange={event => void change({ language: event.target.value === "zh-CN" ? "zh-CN" : "en", market: "ALL" })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
    </div>
    <PreferenceError />
  </section>;
}
