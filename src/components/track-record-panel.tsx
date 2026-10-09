"use client";

import { useEffect, useState } from "react";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import { useAuth } from "@/components/providers/auth-provider";
import type { TrackRecord } from "@/lib/predictions/track-record";

const percent = (value: number | null, signed = true) => value === null ? "—" : `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

/** A verifiable record: each public view's return beside the benchmark over the same dates. */
export function TrackRecordPanel({ userId }: { userId: string }) {
  const { text } = useLocale();
  const { user, loading, getIdToken } = useAuth();
  const [record, setRecord] = useState<TrackRecord | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    // Owners of private profiles must be identified to see their own record.
    getIdToken()
      .then(token => fetch(`/api/users/${encodeURIComponent(userId)}/track-record`, { signal: controller.signal, headers: token ? { authorization: `Bearer ${token}` } : undefined }))
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<TrackRecord>; })
      // An unexpected payload hides the panel instead of breaking the profile.
      .then(data => { if (!data || typeof data.views !== "number" || !Array.isArray(data.recent)) throw new Error(); setRecord(data); }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [userId, user?.uid, loading, getIdToken]);
  if (failed) return null;
  return <section aria-labelledby="track-record-heading" className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
    <h2 id="track-record-heading" className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">{text("Track record", "历史表现")}</h2>
    {!record ? <p role="status" className="mt-2 text-sm text-slate-400">{text("Loading track record…", "正在读取历史表现…")}</p>
      : record.views === 0 ? <p className="mt-2 text-sm text-slate-400">{text("No public views with an entry price yet.", "暂无已确定入场价格的公开观点。")}</p>
      : <>
        <p className="mt-1 text-sm text-slate-400">{text(`Public views since entry. US-listed views are compared with ${record.benchmark} over the same dates; a bearish view is compared with being short ${record.benchmark}. Other markets show no benchmark.`, `公开观点自入场以来的表现。美股观点与同期 ${record.benchmark} 对比，看空观点与做空 ${record.benchmark} 对比；其他市场暂不显示基准。`)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [text("Views", "观点"), `${record.views}`, text(`${record.open} open · ${record.settled} settled`, `${record.open} 进行中 · ${record.settled} 已结算`)],
            [text("Ahead", "领先比例"), percent(record.hitRate, false), text("of views above entry", "高于入场价的观点")],
            [text("Average return", "平均收益"), percent(record.averageReturn), text("in the view's direction", "按观点方向计算")],
            [text(`vs ${record.benchmark}`, `相对 ${record.benchmark}`), percent(record.averageExcess), record.benchmarkCovered === record.views ? text("average excess return", "平均超额收益") : text(`${record.benchmarkCovered} of ${record.views} views have benchmark prices`, `${record.views} 条中 ${record.benchmarkCovered} 条有基准价格`)],
          ].map(([label, value, note]) => <div key={label} className="rounded-xl border border-white/10 p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-cyan-100">{value}</dd><dd className="text-xs text-slate-500">{note}</dd></div>)}
        </dl>
        <div className="mt-4">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{text("Recent public views", "近期公开观点")}</caption>
            <thead className="text-xs text-slate-400"><tr><th className="py-2 font-medium">{text("View", "观点")}</th><th className="hidden font-medium sm:table-cell">{text("Dates", "日期")}</th><th className="text-right font-medium">{text("Return", "收益")}</th><th className="text-right font-medium">{record.benchmark}</th><th className="text-right font-medium">{text("Excess", "超额")}</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {record.recent.map(view => <tr key={view.id}>
                <td className="py-2 pr-3"><Link href={`/predictions/${encodeURIComponent(view.id)}`} className="text-cyan-200 hover:underline">{view.ticker} · {view.direction === "UP" ? text("Bullish", "看多") : text("Bearish", "看空")}</Link>{view.cited ? <span className="ml-2 text-xs text-slate-500">{text(`${view.cited} cited`, `引用 ${view.cited} 项`)}</span> : null}
                  {/* On phones the dates sit under the view so every return column fits. */}
                  <span className="block text-xs text-slate-400 sm:hidden">{view.entryDate} → {view.markDate}{view.status === "SETTLED" ? text(" · settled", " · 已结算") : ""}</span></td>
                <td className="hidden whitespace-nowrap pr-3 text-xs text-slate-400 sm:table-cell">{view.entryDate} → {view.markDate}{view.status === "SETTLED" ? text(" · settled", " · 已结算") : ""}</td>
                <td className="pl-2 text-right tabular-nums">{percent(view.viewReturn)}</td>
                <td className="pl-2 text-right tabular-nums text-slate-400">{percent(view.benchmarkReturn)}</td>
                <td className="pl-2 text-right tabular-nums">{percent(view.excessReturn)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
  </section>;
}
