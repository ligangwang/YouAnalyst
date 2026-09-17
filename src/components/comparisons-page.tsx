"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { localizedPath } from "@/lib/i18n/urls";
import type { Prediction } from "@/lib/predictions/types";

type Comparison = { id: string; name: string; predictions: Array<Prediction & { id: string }> };
function value(p: Prediction) { return p.result?.returnValue ?? p.markReturnValue ?? null; }
export function ComparisonsPage() {
  const { loading, getIdToken, user } = useAuth();
  const { text, locale } = useLocale();
  const [items, setItems] = useState<Comparison[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (loading) return;
    let canceled = false;
    setItems([]); setError(false);
    void (async () => {
      try {
        const token = await getIdToken();
        const response = await fetch("/api/comparisons", { headers: token ? { authorization: `Bearer ${token}` } : undefined });
        if (!response.ok) throw new Error();
        const data = await response.json(); if (!canceled) setItems(data.items);
      } catch { if (!canceled) setError(true); }
    })();
    return () => { canceled = true; };
  }, [loading, getIdToken, user?.uid]);
  return <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-semibold">{text("Compare predictions", "对比预测")}</h1>
    {error && <p role="alert">{text("Unable to load comparisons.", "无法加载对比。")}</p>}
    {items.map(item => {
      const [a, b] = item.predictions;
      const aValue = a ? value(a) : null, bValue = b ? value(b) : null;
      return <section key={item.id} className="my-5 rounded-xl border border-white/10 p-5"><h2 className="text-xl">{item.name}</h2>
        {item.predictions.map(p => <article key={p.id} className="my-4"><Link className="text-cyan-300" href={localizedPath(`/predictions/${p.id}`, locale)}>{p.ticker} · {p.direction === "UP" ? text("Bullish", "看多") : text("Bearish", "看空")}</Link><p>{value(p) == null ? text("Awaiting price", "等待价格") : (value(p)! * 100).toFixed(2) + "%"} · {text("Entry", "入场日期")}: {p.entryDate ?? text("Pending", "待定")}</p></article>)}
        {a && b && aValue !== null && bValue !== null && <p>{a.ticker} − {b.ticker}: {((aValue - bValue) * 100).toFixed(2)} {text("percentage points", "个百分点")}</p>}
        <p className="mt-3 text-sm text-slate-400">{text("Each prediction retains its original entry date and direction. Different entry dates are not a same-period stock-return comparison.", "每条预测保留原始入场日期及方向。入场日期不同时，不代表同一期间的股票收益对比。")}</p>
      </section>;
    })}
  </main>;
}
