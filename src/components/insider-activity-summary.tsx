"use client";
import { useLocale } from "./providers/locale-provider";
import { activityLabel, type InsiderActivity } from "@/lib/events/insider-summary";

export function InsiderActivitySummary({ activity }: {activity:InsiderActivity[]}) {
  const { text, chinese } = useLocale();
  const format = (n:number, maximumFractionDigits = 8) => n.toLocaleString(chinese ? "zh-CN" : "en-US",{maximumFractionDigits});
  return <div className="mt-3 text-sm"><ul className="space-y-3">{activity.map((row,i) => <li key={i}><strong>{row.owner}</strong> · {activityLabel(row.code,chinese)}<div className="mt-1 text-slate-300">{row.shares === null ? text("Quantity not available", "数量未明确") : `${format(row.shares)} ${text("shares / units", "股／单位")}`}{row.security && ` · ${row.security}`}{row.valueUsd !== null && ` · USD ${format(row.valueUsd, 2)}`}</div><div className="mt-1 text-xs text-slate-400">{text("Transaction date", "交易日期")}: <time dateTime={row.date}>{row.date}</time></div></li>)}</ul><p className="mt-3 text-xs text-slate-400">{text("Parsed non-derivative records; this may not include every transaction in the filing. See the source for full terms and footnotes.", "已解析的非衍生品记录，可能不包含该文件的全部交易。完整条款和脚注请核查原文。")}</p></div>;
}
