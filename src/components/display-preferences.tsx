"use client";
import { useLocale } from "./providers/locale-provider";
import { useMarket } from "./providers/market-provider";
export function PreferenceError() {
  const { error } = useMarket(); const { text } = useLocale();
  return error ? <p role="alert" className="mx-auto max-w-6xl px-4 pb-2 text-xs text-rose-300">{text("Could not save your preferences. Please try the selection again.", "偏好保存失败，请重新选择。")}</p> : null;
}
export function DisplayPreferencesPanel() {
  const { text, locale } = useLocale(); const { saving, change, themeMode, changeTheme, priceColors } = useMarket();
  return <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5">
    <h2 className="text-lg font-semibold">{text("Display preferences", "显示偏好")}</h2>
    <p className="mt-2 text-sm text-slate-400">{text("Choose your language, price colors and appearance. Saved to your account.", "选择界面语言、涨跌颜色与主题，偏好保存到你的账号。")}</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex min-w-0 flex-col gap-2 text-sm">{text("Interface language", "界面语言")}<select className="w-full min-w-0 rounded-lg border border-white/15 bg-slate-950 p-2" value={locale} disabled={saving} onChange={event => void change({ language: event.target.value === "zh-CN" ? "zh-CN" : "en", market: "ALL" })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
      <label className="flex min-w-0 flex-col gap-2 text-sm">{text("Price color convention", "涨跌颜色规则")}<select className="w-full min-w-0 rounded-lg border border-white/15 bg-slate-950 p-2" value={priceColors} disabled={saving} onChange={event => void change({ language: locale, market: "ALL", priceColors: event.target.value === "red-up" ? "red-up" : "green-up" })}><option value="green-up">{text("Green Up / Red Down (World)", "绿涨 / 红跌（国际惯例）")}</option><option value="red-up">{text("Red Up / Green Down (China)", "红涨 / 绿跌（中国惯例）")}</option></select></label>
      <label className="flex min-w-0 flex-col gap-2 text-sm">{text("UI theme", "界面主题")}<select className="w-full min-w-0 rounded-lg border border-white/15 bg-slate-950 p-2" value={themeMode} onChange={event => changeTheme(event.target.value === "system" ? "system" : event.target.value === "light" ? "light" : "dark")}><option value="system">{text("System", "跟随系统")}</option><option value="dark">{text("Dark mode", "深色模式")}</option><option value="light">{text("Light mode", "浅色模式")}</option></select></label>
    </div>
    <PreferenceError />
  </section>;
}
