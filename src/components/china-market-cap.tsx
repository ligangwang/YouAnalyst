"use client";
import { cnyLabel, marketCapLabel } from "@/lib/knowledge-graph/market-cap";
import type { PublicCnMarketCap } from "@/lib/fundamentals/cn-service";
import { useLocale } from "./providers/locale-provider";

const reasons: Record<string, [string, string]> = {
  corporate_action_after_share_count: ["A recent share change (bonus issue, placement or buyback cancellation) is not yet reflected in the share count.", "近期股本变动（送转、增发或回购注销）尚未反映在股本数据中。"],
  share_count_newer_than_price: ["The latest share count took effect after the latest close.", "最新股本生效日期晚于最新收盘价日期。"],
  stale_share_count: ["The share count has not been confirmed in the last 180 days.", "股本数据超过 180 天未确认。"],
  corporate_action_check_unavailable: ["Recent share-change announcements could not be checked.", "暂时无法核对近期股本变动公告。"],
  missing_or_invalid_cached_price: ["No stored A-share closing price is available.", "暂无已存储的 A 股收盘价。"],
  h_share_count_unavailable: ["The H-share count is not available.", "暂无 H 股股本数据。"],
  exchange_share_count_mismatch: ["Exchange and issuer share counts do not agree yet.", "交易所与公司披露的股本暂不一致。"],
};

export function ChinaMarketCap({ data }: { data: PublicCnMarketCap | null }) {
  const { text, locale } = useLocale();
  const count = (n: number) => new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US").format(n);
  const estimated = data?.status === "estimated" && data.value !== null && data.shares;
  const reason = data?.reason ? reasons[data.reason] : undefined;
  return <section id="market-cap" aria-labelledby="china-market-cap" className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
    <h2 id="china-market-cap" className="text-lg font-semibold">{text("Estimated market cap", "估算市值")}</h2>
    {estimated ? <>
      <p className="mt-3 text-2xl font-semibold text-white" data-market-cap-cny>{cnyLabel(data.value!, locale)} CNY</p>
      {data.usd && <p className="mt-1 text-sm text-slate-300" data-market-cap-usd>≈ {marketCapLabel({ value: data.usd.value, currency: "USD", priceDate: data.priceDate! })} USD
        {" · "}{text(`USD/CNY ${data.usd.rate.toFixed(4)} on ${data.usd.rateDate}`, `美元兑人民币 ${data.usd.rate.toFixed(4)}（${data.usd.rateDate}）`)}</p>}
      <p className="mt-1 text-sm text-slate-400">{text("As of", "截至")} {data.priceDate}{data.lastClose && text(" (last close; no trade since)", "（最近收盘价，其后未交易）")}</p>
      <details className="mt-3 text-xs leading-6 text-slate-400">
        <summary className="cursor-pointer text-cyan-200">{text("Calculation details", "计算说明")}</summary>
        <p className="mt-2">{text("A-share close × total issued shares (all share classes, including H shares).", "A 股收盘价 × 总股本（含 H 股等全部股份）。")}</p>
        <p>{text("Close", "收盘价")}: ¥{data.close?.toFixed(2)} · {text("Total shares", "总股本")}: {count(data.shares!.total)}
          {" "}({text("A", "A 股")} {count(data.shares!.a)}{data.shares!.h ? ` + ${text("H", "H 股")} ${count(data.shares!.h)}` : ""}{data.shares!.b ? ` + ${text("B", "B 股")} ${count(data.shares!.b)}` : ""})</p>
        <p>{text("Share structure effective", "股本结构生效日")} {data.shares!.date} · {text("confirmed", "核对日期")} {data.shares!.asOf}</p>
        <a href={data.shares!.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline underline-offset-2">{text("Share structure source", "股本数据来源")} ↗</a>
      </details>
    </> : <>
      <p className="mt-3 text-2xl font-semibold text-white">{text("Unavailable", "暂无")}</p>
      <p className="mt-2 text-xs text-slate-400">{reason ? text(...reason) : text("An official share count and a stored closing price are required. Updated daily.", "需要官方股本数据和已存储的收盘价，每日更新。")}</p>
    </>}
  </section>;
}
