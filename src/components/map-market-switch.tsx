"use client";
import { useLocale } from "./providers/locale-provider";
import { useMarket } from "./providers/preferences-context";
import type { MarketSelection } from "@/lib/preferences";
export function MapMarketSwitch({ selected = "US" }: { selected?: MarketSelection }) {
  const { text, locale } = useLocale();
  const { change, saving } = useMarket();
  return <nav aria-label={text("Market", "市场")} className={`mx-auto flex gap-2 pt-6 text-sm ${selected === "ALL" ? "max-w-[1440px] px-4 md:px-6" : "max-w-6xl px-4"}`}>
    {(["US", "CN_A", "ALL"] as const).map(market => <button key={market} type="button" disabled={saving} aria-pressed={selected === market} onClick={() => void change({ language: locale, market })} className={`rounded-full border border-white/15 px-4 py-2 ${selected === market ? "bg-white/15" : "text-slate-400"}`}>{market === "US" ? text("US", "美股") : market === "CN_A" ? text("A-shares", "A 股") : text("All markets", "全部市场")}</button>)}
  </nav>;
}
