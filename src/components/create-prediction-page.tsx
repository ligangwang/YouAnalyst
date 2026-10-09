"use client";
import { trackEvent } from "@/lib/analytics";
import { translateUi } from "@/lib/i18n/translate";
import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { TickerSearchInput } from "./ticker-search-input";
import { localizedPath } from "@/lib/i18n/urls";
import { predictionSignInHref } from "@/lib/auth-continuation";
import { predictionInstrument } from "@/lib/predictions/instrument";
import type { CoverageGraph } from "@/lib/posts/evidence";
import type { CompanyThemeId } from "@/lib/company-themes/model";
import { isCoveredCompany, MAX_VIEW_EVIDENCE, mergeCoverageGraphs, relationshipLabel, relationshipsForCompany, researchForCompany, type ViewEvidenceRef } from "@/lib/posts/evidence";

const key = (ref: ViewEvidenceRef) => `${ref.kind}:${ref.id}`;

/** The AI, Robotics and Space maps, loaded once: they decide which companies can receive views and what a view can cite. */
function useCoverageGraph() {
  const [graph, setGraph] = useState<CoverageGraph | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(["ai", "robotics", "space"].map(theme => fetch(`/api/knowledge-graph${theme === "ai" ? "" : `?theme=${theme}`}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json().then(graph => ({ theme: theme as CompanyThemeId, graph })); })))
      .then(graphs => setGraph(mergeCoverageGraphs(graphs))).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return { graph, failed };
}

export function CreatePredictionPage({ requestedTicker = "", requestedDirection, requestedRelationship = "" }: { requestedTicker?: string; requestedWatchlistId?: string; requestedDirection?: "UP" | "DOWN"; requestedRelationship?: string }) {
  const { user, loading, getIdToken } = useAuth();
  const { text, locale } = useLocale();
  const router = useRouter();
  const [ticker, setTicker] = useState(requestedTicker);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState<"" | "UP" | "DOWN">(requestedDirection ?? "");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [cited, setCited] = useState<string[]>(requestedRelationship ? [`relationship:${requestedRelationship}`] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  const { graph, failed } = useCoverageGraph();
  const companyId = predictionInstrument(ticker)?.companyId ?? "";
  const covered = !graph || !companyId ? null : isCoveredCompany(graph, companyId);
  const options = useMemo(() => {
    if (!graph || !companyId || !covered) return [];
    return [
      ...relationshipsForCompany(graph, companyId).map(edge => ({ kind: "relationship" as const, id: edge.id, label: relationshipLabel(graph, edge.id)![locale === "zh-CN" ? "zh-CN" : "en"] })),
      ...researchForCompany(companyId).map(item => ({ kind: "research" as const, id: item.id, label: (locale === "zh-CN" ? item.title.zh : item.title.en) })),
    ];
  }, [graph, companyId, covered, locale]);
  const available = new Set(options.map(key));
  const evidence = options.filter(option => cited.includes(key(option))).map(({ kind, id }) => ({ kind, id }));
  const needsEvidence = Boolean(direction) && covered === true && evidence.length === 0;

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const token = await getIdToken();
      if (!token) throw new Error(text("Sign in to publish", "请登录后发布"));
      const data = { ticker, title, body, direction: direction || null, visibility, evidence };
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
  if (!user) return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl">{text("Publish a view", "发布观点")}</h1><Link className="text-cyan-300" href={predictionSignInHref(requestedTicker, "", requestedDirection)}>{text("Sign in to publish", "请登录后发布")}</Link></main>;
  const inputClass = "w-full rounded-lg border border-white/20 bg-slate-900 p-3";
  return <main className="mx-auto max-w-3xl p-6"><h1 className="mb-2 text-2xl font-semibold">{text("Publish a view", "发布观点")}</h1>
    <p className="mb-5 text-sm text-slate-400">{text("Analyst views cover companies on the AI, Robotics and Space maps. A bullish or bearish view cites the relationships or research it builds on.", "分析师观点覆盖 AI、机器人与航天图谱中的公司。看多或看空观点需引用其依据的关系或研究。")}</p>
    <form onSubmit={publish} className="grid gap-5">
      <TickerSearchInput value={ticker} onChange={setTicker} predictionSearch label={text("Company", "公司")} />
      {covered === false && <p role="alert" className="rounded-lg border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100">{text("This company is not on the AI, Robotics or Space maps yet. Analyst views cover map companies only.", "该公司尚未收录在 AI、机器人或航天图谱中。分析师观点仅覆盖图谱中的公司。")} <Link className="underline" href={localizedPath("/", locale)}>{text("Browse the maps", "浏览图谱")}</Link></p>}
      <label>{text("Title", "标题")}<input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} /></label>
      <label>{text("Thesis", "论点")}<textarea className={inputClass} rows={10} value={body} onChange={e => setBody(e.target.value)} required maxLength={10000} /></label>
      <label>{text("View", "观点")}<select className={inputClass} value={direction} onChange={e => setDirection(e.target.value as typeof direction)}><option value="">{text("Research only", "仅发布研究")}</option><option value="UP">{text("Bullish", "看多")}</option><option value="DOWN">{text("Bearish", "看空")}</option></select></label>
      {covered && <fieldset className="grid gap-2 rounded-lg border border-white/15 p-4">
        <legend className="px-1 text-sm font-semibold">{text("Evidence", "依据")} <span className="font-normal text-slate-400">{direction ? text("(required, up to 5)", "（必填，最多 5 项）") : text("(optional, up to 5)", "（可选，最多 5 项）")}</span></legend>
        {options.length === 0 && <p className="text-sm text-slate-400">{text("No documented relationships or research cover this company yet, so it can only receive research-only posts.", "该公司暂无已收录的关系或研究，因此只能发布仅研究的文章。")}</p>}
        {options.map(option => <label key={key(option)} className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={cited.includes(key(option))} disabled={!cited.includes(key(option)) && evidence.length >= MAX_VIEW_EVIDENCE}
            onChange={e => setCited(current => e.target.checked ? [...current.filter(item => available.has(item)), key(option)] : current.filter(item => item !== key(option)))} />
          <span><span className="mr-1 text-xs uppercase tracking-wide text-slate-500">{option.kind === "relationship" ? text("Relationship", "关系") : text("Research", "研究")}</span>{option.label}</span>
        </label>)}
      </fieldset>}
      {failed && <p className="text-sm text-slate-400">{text("Coverage could not be loaded; it will be checked when you publish.", "暂时无法读取覆盖范围，发布时会再次核验。")}</p>}
      <p className="text-sm text-slate-400">{text("Bullish or bearish views track performance from the entry price. Research-only posts do not. The same direction updates your active view without changing its entry price. Close the existing view before reversing direction. Private views require Pro.", "看多或看空观点从入场价格开始跟踪表现，仅发布研究则不跟踪收益。同方向文章会更新现有观点并保留入场价格。改变方向前，请先关闭原观点。私密观点需要 Pro。")}</p>
      <label>{text("Visibility", "可见范围")}<select className={inputClass} value={visibility} onChange={e => setVisibility(e.target.value)}><option value="PUBLIC">{text("Public", "公开")}</option><option value="PRIVATE">{text("Only me", "仅自己")}</option></select></label>
      {error && <p role="alert" className="text-amber-200">{translateUi(error, locale)} <Link href={localizedPath("/my/predictions", locale)} className="underline">{text("My views", "我的观点")}</Link></p>}
      {needsEvidence && <p className="text-sm text-amber-200">{text("Cite at least one relationship or research report to publish a bullish or bearish view.", "发布看多或看空观点前，请至少引用一项关系或研究。")}</p>}
      <button disabled={busy || covered === false || needsEvidence} className="rounded-lg bg-cyan-400 p-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? text("Publishing…", "发布中…") : text("Publish", "发布")}</button>
    </form></main>;
}
