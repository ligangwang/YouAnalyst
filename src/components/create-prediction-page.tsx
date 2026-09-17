"use client";
import { trackEvent } from "@/lib/analytics";
import { translateUi } from "@/lib/i18n/translate";
import Link from "next/link";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { TickerSearchInput } from "./ticker-search-input";
import { localizedPath } from "@/lib/i18n/urls";
import { predictionSignInHref } from "@/lib/auth-continuation";

export function CreatePredictionPage({ requestedTicker = "", requestedDirection }: { requestedTicker?: string; requestedWatchlistId?: string; requestedDirection?: "UP" | "DOWN" }) {
  const { user, loading, getIdToken } = useAuth();
  const { text, locale } = useLocale();
  const router = useRouter();
  const [ticker, setTicker] = useState(requestedTicker);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState<"" | "UP" | "DOWN">(requestedDirection ?? "");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const token = await getIdToken();
      if (!token) throw new Error(text("Sign in to publish", "请登录后发布"));
      const data = { ticker, title, body, direction: direction || null, visibility };
      const payload = JSON.stringify(data);
      if (request.current?.payload !== payload) request.current = { payload, id: Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("") };
      const response = await fetch("/api/posts", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ ...data, requestId: request.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || text("Unable to publish", "暂时无法发布"));
      if (result.predictionId) trackEvent("prediction_publish", { visibility: visibility.toLowerCase() });
      router.push(localizedPath(result.predictionId ? "/predictions/" + result.predictionId : "/posts/" + result.id, locale));
    } catch (cause) { setError(cause instanceof Error ? cause.message : text("Unable to publish", "暂时无法发布")); }
    finally { setBusy(false); }
  }
  if (loading) return <p>{text("Loading…", "加载中…")}</p>;
  if (!user) return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl">{text("Publish company research", "发布公司研究")}</h1><Link className="text-cyan-300" href={predictionSignInHref(requestedTicker, "", requestedDirection)}>{text("Sign in to publish", "请登录后发布")}</Link></main>;
  const inputClass = "w-full rounded-lg border border-white/20 bg-slate-900 p-3";
  return <main className="mx-auto max-w-3xl p-6"><h1 className="mb-4 text-2xl font-semibold">{text("Publish company research", "发布公司研究")}</h1>
    <form onSubmit={publish} className="grid gap-5">
      <TickerSearchInput value={ticker} onChange={setTicker} predictionSearch label={text("Company", "公司")} />
      <label>{text("Title", "标题")}<input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} /></label>
      <label>{text("Article", "文章")}<textarea className={inputClass} rows={10} value={body} onChange={e => setBody(e.target.value)} required maxLength={10000} /></label>
      <label>{text("Investment view (optional)", "投资观点（可选）")}<select className={inputClass} value={direction} onChange={e => setDirection(e.target.value as typeof direction)}><option value="">{text("Research only", "仅发布研究")}</option><option value="UP">{text("Bullish", "看多")}</option><option value="DOWN">{text("Bearish", "看空")}</option></select></label>
      <p className="text-sm text-slate-400">{text("The same view updates your active prediction without changing its entry price. To reverse your view, explicitly close the existing prediction first. Private predictions require Pro.", "相同观点会更新现有预测，保留原始入场价格。改变方向前，请先明确关闭原预测。私密预测需要 Pro。")}</p>
      <label>{text("Visibility", "可见范围")}<select className={inputClass} value={visibility} onChange={e => setVisibility(e.target.value)}><option value="PUBLIC">{text("Public", "公开")}</option><option value="PRIVATE">{text("Only me", "仅自己")}</option></select></label>
      {error && <p role="alert" className="text-amber-200">{translateUi(error, locale)} <Link href={localizedPath("/my/predictions", locale)} className="underline">{text("My predictions", "我的预测")}</Link></p>}
      <button disabled={busy} className="rounded-lg bg-cyan-400 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? text("Publishing…", "发布中…") : text("Publish", "发布")}</button>
    </form></main>;
}
