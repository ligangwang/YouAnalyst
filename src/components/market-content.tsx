"use client";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { useMarket } from "./providers/market-provider";
import { useLocale } from "./providers/locale-provider";
import { ChinaSupplyChain } from "./china-supply-chain";
function ChinaDirectory() {
  const params = useSearchParams();
  return <ChinaSupplyChain key={params.get("q") ?? ""} initialQuery={params.get("q") ?? ""} />;
}

export function MarketContent({ children }: { children: ReactNode }) {
  const { market } = useMarket(); const { text } = useLocale(); const path = usePathname();
  const discovery = path === "/" || path === "/predictions" || path === "/predictions/new" || path === "/institutions" || path === "/leaderboard" || path.startsWith("/daily");
  if (market === "CN_A" && path === "/companies") return <Suspense><ChinaDirectory /></Suspense>;
  if (market === "CN_A" && discovery) return <main className="mx-auto max-w-3xl px-4 py-16">
    <p className="text-xs text-cyan-200">{text("A-SHARES", "A 股")}</p><h1 className="mt-4 text-2xl font-semibold">{text("A-share coverage is growing", "A 股数据接入中")}</h1>
    <p className="mt-4 text-sm leading-7 text-slate-400">{text("A-share live events, prices and call tracking are not connected yet. Explore the source-linked AI supply chain, or select US / All markets to view available US data.", "A 股实时动态、行情与观点跟踪尚未接入。你可以先探索有来源的 AI 产业链，或选择美股 / 全部市场查看现有美股数据。")}</p>
    <Link href="/map?market=CN_A" className="mt-6 inline-block rounded-full border border-white/20 px-5 py-3 text-sm">{text("Explore the A-share AI supply chain", "探索 A 股 AI 产业链")}</Link>
  </main>;
  return <>{market !== "US" && path !== "/map" && <p role="status" className="mx-auto max-w-6xl px-4 pt-4 text-xs text-slate-400">{text("Available events, prices and calls currently cover US securities. A-share research is available in Explore. Existing records keep their own market.", "当前动态、行情与观点数据覆盖美股；A 股研究可在“探索”中查看。已有记录保留其所属市场。")}</p>}{children}</>;
}
