"use client";
import Link from "next/link";
import { useLocale } from "./providers/locale-provider";
export function MapMarketSwitch({ china }: { china: boolean }) {
  const { text } = useLocale();
  return <nav aria-label={text("Market", "市场")} className="mx-auto flex max-w-6xl gap-2 px-4 pt-6 text-sm">
    <Link href="/map" aria-current={!china ? "page" : undefined} className={`rounded-full border border-white/15 px-4 py-2 ${!china ? "bg-white/15" : "text-slate-400"}`}>{text("US · Company connections", "美股 · 公司关系")}</Link>
    <Link href="/map?market=CN_A" aria-current={china ? "page" : undefined} className={`rounded-full border border-white/15 px-4 py-2 ${china ? "bg-white/15" : "text-slate-400"}`}>{text("A-shares · AI supply chain", "A 股 · AI 产业链")}</Link>
  </nav>;
}
