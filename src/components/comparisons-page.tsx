"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { localizedPath } from "@/lib/i18n/urls";
import type { Prediction } from "@/lib/predictions/types";
import { PredictionReturnSummary } from "./prediction-ui";

type Comparison = { id: string; name: string; predictions: Array<Prediction & { id: string }> };
function value(p: Prediction) { return p.result?.returnValue ?? p.markReturnValue ?? null; }
export function ComparisonsPage({ ownerId, embedded = false }: { ownerId?: string; embedded?: boolean } = {}) {
  const { loading, getIdToken, user } = useAuth();
  const { text, locale } = useLocale();
  const [items, setItems] = useState<Comparison[]>([]);
  const [error, setError] = useState(false);
  const Wrapper = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const CardHeading = embedded ? "h3" : "h2";
  useEffect(() => {
    if (loading) return;
    let canceled = false;
    setItems([]); setError(false);
    void (async () => {
      try {
        const token = await getIdToken();
        const response = await fetch(`/api/comparisons${ownerId ? `?userId=${encodeURIComponent(ownerId)}` : ""}`, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
        if (!response.ok) throw new Error();
        const data = await response.json(); if (!canceled) setItems(data.items);
      } catch { if (!canceled) setError(true); }
    })();
    return () => { canceled = true; };
  }, [loading, getIdToken, user?.uid, ownerId]);
  const comparableItems = items.filter(item => item.predictions.length >= 2 && item.predictions[0].entryDate && item.predictions.every(p => p.entryDate === item.predictions[0].entryDate));
  if (embedded && !error && !comparableItems.length) return null;
  return <Wrapper className={embedded ? "my-6" : "mx-auto max-w-4xl p-6"}><Heading className="text-2xl font-semibold">{text("Performance comparison", "表现对比")}</Heading>
    {error && <p role="alert">{text("Unable to load comparisons.", "无法加载对比。")}</p>}
    {comparableItems.map(item => {
      return <section key={item.id} className="my-3 rounded-xl border border-white/10 p-4"><CardHeading className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl font-semibold"><span>{item.name}</span>{" "}<span className="text-sm font-normal text-slate-400">{text("Entry", "入场日期")}: {item.predictions[0].entryDate}</span></CardHeading>
        {item.predictions.map(p => {
          const returnValue = value(p);
          return <article key={p.id} className="my-4 border-t border-white/10 pt-4">
            <Link className="font-semibold" href={localizedPath(`/predictions/${p.id}`, locale)}>
              <span className={p.direction === "UP" ? "text-emerald-300" : "text-rose-300"}>{p.direction === "UP" ? "↑" : "↓"} {p.ticker} · {p.direction === "UP" ? text("Bullish", "看多") : text("Bearish", "看空")}</span>
            </Link>
            <PredictionReturnSummary prediction={{ ...p, markReturnValue: returnValue }} status={p.status} href={localizedPath(`/predictions/${p.id}`, locale)} />
          </article>;
        })}
      </section>;
    })}
  </Wrapper>;
}
