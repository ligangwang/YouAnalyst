"use client";

import { useEffect, useState } from "react";
import { CompanyFollowButton, useCompanyFollows } from "./company-follow-button";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { companyRole, relationshipExplanation, relationshipBusiness, researchCompanyUrl } from "@/lib/knowledge-graph/research-view";
import { companyUpdates, type CompanyUpdate } from "@/lib/knowledge-graph/company-updates";
import { InsiderActivitySummary } from "./insider-activity-summary";

export function FollowedCompaniesPage({ feed = false }: { feed?: boolean }) {
  const { text, chinese, locale } = useLocale();
  const follows = useCompanyFollows();
  const { getIdToken } = useAuth();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [showUpdates, setShowUpdates] = useState(feed);
  const [updates, setUpdates] = useState<{ uid: string; key: string; items: CompanyUpdate[]; filingsAvailable: boolean } | null>(null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0), [limit, setLimit] = useState(20);
  const idsKey = [...follows.ids].sort().join(","), uid = follows.user?.uid;
  useEffect(() => {
    if (uid || follows.loading) return;
    const controller = new AbortController();
    void fetch("/api/knowledge-graph", {signal:controller.signal}).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(g => { if (!controller.signal.aborted) setGraph(g); }).catch(() => {});
    return () => controller.abort();
  }, [uid, follows.loading]);
  useEffect(() => {
    if (!uid || !follows.ready) return;
    const controller = new AbortController();
    async function load() {
      try {
        const token = await getIdToken();
        if (!token) throw new Error();
        const [g, u] = await Promise.all([fetch("/api/knowledge-graph", { signal: controller.signal }), fetch("/api/company-updates", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })]);
        if (!g.ok || !u.ok) throw new Error();
        const [graph, result] = await Promise.all([g.json(), u.json()]);
        if (!controller.signal.aborted) { setGraph(graph); setUpdates({ ...result, uid, key: idsKey }); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [uid, follows.ready, idsKey, getIdToken, retry]);
  const items = uid && updates?.uid === uid && updates.key === idsKey ? updates.items.filter(i => i.companyIds.some(id => follows.ids.includes(id))) : null;
  return <main className="mx-auto max-w-6xl px-4 py-8">
    <header className="border-b border-white/10 pb-6"><p className="text-xs tracking-widest text-cyan-300">{text("YOUR RESEARCH", "你的研究")}</p><h1 className="mt-2 text-3xl font-semibold">{text("Following", "我的关注")}</h1><p className="mt-3 text-sm text-slate-400">{text("A private list of companies to keep researching. No bullish or bearish call required.", "私密保存想继续研究的公司，无需先发表看多或看空判断。")}</p><div className="mt-4 flex flex-wrap gap-5 text-sm text-cyan-200" role="group" aria-label={text("Following views", "关注视图")}><button aria-pressed={!showUpdates} onClick={() => setShowUpdates(false)} className="border-b-2 border-transparent pb-2 aria-pressed:border-cyan-300">{text("Companies", "公司")}</button><button aria-pressed={showUpdates} onClick={() => setShowUpdates(true)} className="border-b-2 border-transparent pb-2 aria-pressed:border-cyan-300">{text("Updates", "更新")}</button><Link className="ml-auto" href="/feed">{text("All updates", "全部动态")}</Link></div></header>
    {follows.loading ? <p role="status" className="mt-6">{text("Loading…", "加载中…")}</p> : !follows.user ? <section className="my-8 rounded-xl border border-white/10 p-6"><h2 className="text-lg">{text("Keep your research in one place", "保存关注，继续研究")}</h2><Link className="mt-4 inline-block rounded-full bg-cyan-300 px-5 py-2 text-slate-950" href={`/auth?${new URLSearchParams({ next: `/${locale === "zh-CN" ? "zh-cn" : "en"}${showUpdates ? "/feed?scope=following" : "/watchlists/following"}` })}`}>{text("Sign in / create account", "登录／注册")}</Link><FollowingPreview graph={graph} updates={showUpdates} /></section> : <>
      {(error || follows.error) && <p role="alert" className="mt-6 text-rose-300">{text("Could not load your research. ", "暂时无法加载关注资料。 ")}<button className="underline" onClick={() => { void follows.refresh(); setRetry(n => n + 1); }}>{text("Retry", "重试")}</button></p>}
      {!follows.ready ? !follows.error && <p role="status" className="mt-6">{text("Loading follows…", "正在加载关注列表…")}</p> : follows.ids.length === 0 ? <section className="my-8 rounded-xl border border-dashed border-white/20 p-6"><h2>{text("You haven’t followed any companies yet.", "你还没有关注公司。")}</h2><Link className="mt-3 inline-block text-cyan-200 underline" href="/">{text("Explore companies on the 3D map", "去 3D 图谱探索公司")}</Link></section> : <>
        {!showUpdates && <section className="mt-7"><h2 className="text-xl font-semibold">{text("Followed companies", "关注的公司")} <span className="text-slate-400">{follows.ids.length}</span></h2><ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{follows.ids.map(id => {
          const n = graph?.nodes.find(n => n.id === id);
          return <li key={id} className="min-w-0 rounded-xl border border-white/10 p-4"><h3 className="font-semibold">{n ? companyName(n, locale) : id}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{n ? companyRole(n, chinese) : text("Research coverage is not available yet.", "研究资料尚待覆盖。")}</p><div className="mt-4 flex flex-wrap items-center gap-4"><Link href={researchCompanyUrl(n ?? { id })} className="text-sm text-cyan-200 underline">{text("Continue research", "继续研究")}</Link><CompanyFollowButton companyId={id} /></div></li>;
        })}</ul></section>}
        <section className="mt-8" hidden={!showUpdates}><h2 className="text-xl font-semibold">{text("What changed in companies you follow", "我关注的公司有什么变化")}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{text("Verified relationship evidence and recent filings. Ordered by collection date; older source material is not a new business event. Coverage starts with researched AI companies.", "展示已核实的关系证据和近期披露，按收录时间排列；新收录的旧资料不代表新发生的业务事件。当前优先覆盖已有可靠研究的 AI 公司。")}</p>{updates && updates.uid === uid && !updates.filingsAvailable && <p className="mt-2 text-sm text-amber-200">{text("Filing updates are temporarily unavailable; relationship evidence is shown below.", "公告更新暂时无法加载，以下展示关系研究证据。")}</p>}
          {!items ? !error && <p role="status" className="mt-5">{text("Loading updates…", "加载更新中…")}</p> : !items.length ? <p className="mt-5 rounded-xl border border-dashed border-white/20 p-5">{text("No reliable updates available for these companies yet.", "这些公司暂时没有可核实的更新。")}</p> : <ol className="mt-5 space-y-4">{items.slice(0, limit).map(item => {
            const edge = graph?.relationships.find(e => e.id === item.edgeId);
            const fact = edge?.facts?.find(f => f.id === item.factId);
            const scoped = edge && fact ? { ...edge, facts: [fact] } : edge;
            return <li key={item.id}><article className="rounded-xl border border-white/10 p-5"><p className="text-xs text-cyan-200">{item.kind === "RESEARCH" ? text("Research evidence added / reviewed", "研究证据收录／复核") : text("SEC disclosure", "SEC 公告披露")}{item.state === "ANNOUNCED" && ` · ${text("Announced / planned", "已宣布／计划中")}`}</p><h3 className="mt-2 text-base font-semibold"><Link href={item.href} className="hover:text-cyan-200">{scoped && graph ? relationshipExplanation(scoped, graph, chinese) : item.sourceTitle}</Link></h3>{scoped && <p className="mt-2 text-sm text-slate-300">{text("Product / business", "产品／业务")}: {relationshipBusiness(scoped, chinese)}</p>}
              {item.kind === "RESEARCH" && <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>}
              {!!item.activity?.length && <InsiderActivitySummary activity={item.activity} />}
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-cyan-200">{item.companyIds.map(id => { const n = graph?.nodes.find(n => n.id === id); return n ? <Link key={id} href={researchCompanyUrl(n)}>{companyName(n, locale)}</Link> : null; })}</div>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400"><div><dt>{item.kind === "FILING" ? text("Filing date", "公告披露日期") : text("Event date", "事件日期")}</dt><dd>{item.eventDate?.slice(0,10) ?? text("Not specified by source", "来源未明确")}</dd></div><div><dt>{text("Source published", "资料发布日期")}</dt><dd>{item.sourceDate?.slice(0,10) ?? text("Unknown", "未注明")}</dd></div><div><dt>{text("Collected / reviewed", "收录／复核日期")}</dt><dd>{item.collectedAt.slice(0,10)}</dd></div></dl>
              <a className="mt-3 inline-block break-words text-sm text-cyan-200 underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{text("Read source", "核查来源")} ↗</a><Link className="ml-5 mt-3 inline-block text-sm text-cyan-200 underline" href={item.href}>{text("Research this update", "继续研究这条更新")}</Link></article></li>;
          })}</ol>}{items && items.length > limit && <button className="mt-5 rounded-full border border-cyan-400/30 px-4 py-2 text-sm text-cyan-200" onClick={() => setLimit(n => n + 20)}>{text("Show more", "显示更多")}</button>}
        </section>
      </>}
    </>}
  </main>;
}

function FollowingPreview({ graph, updates }: { graph: KnowledgeGraph | null; updates: boolean }) {
  const { text, chinese, locale } = useLocale();
  const examples = graph?.nodes.filter(n => ["US:AMD", "US:NVDA", "US:MU"].includes(n.id)) ?? [];
  const items = graph ? companyUpdates(graph, examples.map(n => n.id)).slice(0, 2) : [];
  return <section className="mt-7" aria-label={text("Following preview", "关注预览")}>
    <h3 className="font-semibold text-cyan-200">{text("Preview — public examples", "预览——公开资料示例")}</h3><p className="mt-2 text-sm text-slate-400">{text("These are real companies and sources, not a saved list. Follow companies to create your own private view.", "以下为真实公司和公开来源示例，并非已保存的关注。关注公司后即可建立自己的私密列表。")}</p>
    {!graph ? <p className="mt-4 text-sm text-slate-400">{text("Public examples are currently loading or unavailable.", "公开示例正在加载或暂时不可用。")}</p> : updates ? <div className="mt-4 space-y-3">{items.length ? items.map(item => <article key={item.id} className="rounded-xl border border-white/10 p-4"><p className="text-xs text-cyan-200">{text("Research evidence added / reviewed", "研究证据收录／复核")}</p><p className="mt-2 text-sm">{item.description}</p><p className="mt-2 text-xs text-slate-400">{text("Source published", "资料发布日期")}: {item.sourceDate ?? text("Unknown", "未注明")} · {text("Collected / reviewed", "收录／复核")}: {item.collectedAt.slice(0,10)}</p><Link href={item.href} className="mt-2 inline-block text-sm text-cyan-200 underline">{text("Explore this research", "查看这项研究")}</Link></article>) : <p className="text-sm text-slate-400">{text("No reliable updates available for these examples yet.", "示例公司暂无可靠更新。")}</p>}</div> : <ul className="mt-4 grid gap-3 sm:grid-cols-3">{examples.map(node => <li key={node.id} className="rounded-xl border border-white/10 p-4"><h4 className="font-semibold">{companyName(node, locale)}</h4><p className="mt-2 text-sm text-slate-400">{companyRole(node, chinese)}</p><Link href={researchCompanyUrl(node)} className="mt-3 inline-block text-sm text-cyan-200 underline">{text("Explore company", "查看公司")}</Link></li>)}</ul>}
  </section>;
}
