"use client";
import { formatCallPrice } from "@/lib/predictions/instrument";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { PredictionReturnSummary } from "./prediction-ui";
import { CompanyPosts } from "./company-posts";
import { ComparisonsPage } from "./comparisons-page";
import { localizedPath } from "@/lib/i18n/urls";
import type { Prediction } from "@/lib/predictions/types";

export function MyPredictionsPage({ ownerId, embedded = false }: { ownerId?: string; embedded?: boolean } = {}) {
  const { user, loading, getIdToken } = useAuth();
  const { text, locale } = useLocale();
  const targetId = ownerId ?? user?.uid;
  const Wrapper = embedded ? "section" : "main";
  const [rows, setRows] = useState<Array<Prediction & { id: string }>>([]);
  const [primary, setPrimary] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    if (loading || !targetId) return;
    let canceled = false;
    setRows([]); setError(false); setPending(true);
    void (async () => {
      try {
        const token = await getIdToken();
        if (user && !token) throw new Error();
        if (user?.uid === targetId) {
          const selectionResponse = await fetch("/api/predictions/primary", { headers: { authorization: "Bearer " + token } });
          if (selectionResponse.ok) { const selection = await selectionResponse.json(); if (!canceled) setPrimary(selection.primaryPredictions ?? {}); }
        }
        let cursor: string | null = null;
        const all: Array<Prediction & { id: string }> = [];
        do {
          const query: URLSearchParams = new URLSearchParams({ userId: targetId, includePrivate: user?.uid === targetId ? "true" : "false", limit: "50", ...(cursor ? { cursorCreatedAt: cursor } : {}) });
          const response: Response = await fetch(`/api/predictions?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
          if (!response.ok) throw new Error();
          const data: { items: Array<Prediction & { id: string }>; nextCursor: string | null } = await response.json();
          all.push(...data.items); cursor = data.nextCursor;
        } while (cursor && !canceled);
        if (!canceled) setRows(all);
      } catch { if (!canceled) setError(true); }
      finally { if (!canceled) setPending(false); }
    })();
    return () => { canceled = true; };
  }, [user, loading, getIdToken, targetId]);
  async function selectPrimary(row: Prediction & { id: string }) {
    setSaving(true); setSelectionError(false);
    try {
      const token = await getIdToken();
      const response = await fetch("/api/predictions/primary", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ predictionId: row.id }) });
      if (!response.ok) throw new Error();
      setPrimary(current => ({ ...current, [row.ticker]: row.id }));
    } catch { setSelectionError(true); }
    finally { setSaving(false); }
  }
  const duplicates = new Set(rows.filter(row => ["OPEN", "CREATED"].includes(row.status)).filter((row, _, all) => all.filter(other => other.ticker === row.ticker).length > 1).map(row => row.ticker));
  return <Wrapper className="mx-auto max-w-4xl p-6"><div className="flex justify-between gap-4"><h1 className="text-2xl font-semibold">{text(ownerId ? "Investment ideas" : "My ideas", ownerId ? "投资观点" : "我的观点")}</h1><Link className="text-cyan-300" href={localizedPath("/predictions/new", locale)}>{text("Publish an idea", "发布观点")}</Link></div>
    {loading ? <p>{text("Loading…", "加载中…")}</p> : !targetId ? <Link href={"/auth?next=" + encodeURIComponent(localizedPath("/my/predictions", locale))}>{text("Sign in", "登录")}</Link> : <>
      <ComparisonsPage ownerId={targetId} embedded />
      <h2 className="mt-6 text-xl font-semibold">{text("Track record", "历史表现")}</h2>
      {selectionError && <p role="alert">{text("Unable to save your selection. Please retry.", "无法保存选择，请重试。")}</p>}
      {pending ? <p>{text("Loading…", "加载中…")}</p> : error ? <p role="alert">{text("Unable to load ideas.", "无法加载观点。")}</p> : !rows.length ? <p>{text("No tracked ideas yet. Publish a bullish or bearish idea to start your track record.", "暂无跟踪中的观点。发布看多或看空观点，即可开始记录历史表现。")}</p> : rows.map(row => <article key={row.id} className="my-3 rounded-xl border border-white/10 p-4">
        <Link className="font-semibold" href={localizedPath(`/predictions/${row.id}`, locale)}><span className={row.direction === "UP" ? "text-emerald-300" : "text-rose-300"}>{row.direction === "UP" ? "↑" : "↓"} {row.ticker}{row.thesisTitle?.trim() ? ` · ${row.thesisTitle.trim()}` : ""}</span></Link>
        <p className="text-sm text-slate-400">{text("Entry", "入场")}: {row.entryDate ?? text("Pending", "待定")} · {row.entryPrice == null ? text("Awaiting price", "等待价格") : formatCallPrice(row.entryPrice, row.ticker)}</p>
        {user?.uid === targetId && duplicates.has(row.ticker) && ["CREATED", "OPEN"].includes(row.status) && <button disabled={saving || primary[row.ticker] === row.id} onClick={() => void selectPrimary(row)} className="my-2 rounded border border-cyan-400/40 px-3 py-2 text-cyan-200 disabled:opacity-60">{primary[row.ticker] === row.id ? text("Receives future articles", "接收后续文章") : text("Use for future articles", "用于后续文章")}</button>}<PredictionReturnSummary prediction={row} status={row.status} href={localizedPath(`/predictions/${row.id}`, locale)} />
      </article>)}
      <CompanyPosts userId={targetId} />
    </>}
  </Wrapper>;
}
