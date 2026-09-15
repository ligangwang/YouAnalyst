"use client";

import { useEffect, useState } from "react";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import { CompanyFollowButton } from "./company-follow-button";
import { companyName, type KnowledgeGraph, type GraphEdge } from "@/lib/knowledge-graph/model";
import { companyRole, relationshipBusiness, relationshipExplanation, relationshipGroup, relationAnchor, researchCompanyUrl } from "@/lib/knowledge-graph/research-view";

export function RelationshipEvidence({ edge, graph }: { edge: GraphEdge; graph: KnowledgeGraph }) {
  const { text, chinese } = useLocale();
  const facts = edge.facts?.length ? edge.facts : [{ scope: edge.summary, state: edge.commercialStatus, sourceIds: edge.sourceIds }];
  return <div className="mt-3 space-y-3">
    {facts.map((fact, i) => <div key={fact.id ?? i} className="border-l-2 border-cyan-700 pl-3">
      <p className="text-xs text-cyan-200">{fact.state === "ANNOUNCED" || edge.type === "PLANNED_ADOPTER_OF" ? text("Announced / planned — delivery not confirmed", "已宣布／计划中，尚不代表已交付") : text("Documented — status as described by source", "已有来源记录，以资料所述状态为准")}</p>
      <p className="mt-2 text-sm leading-6 text-slate-200">{relationshipExplanation({ ...edge, facts: [fact] }, graph, chinese)}</p>
      <p className="mt-1 text-sm text-slate-400">{text("Product / business", "产品／业务")}: {relationshipBusiness({ ...edge, facts: [fact] }, chinese)}</p>
      <details className="mt-2 text-sm text-slate-400"><summary className="cursor-pointer text-cyan-200">{text("Source description and scope", "来源说明与适用范围")}</summary><p className="mt-2 whitespace-pre-line break-words leading-6">{fact.scope}</p>{fact.limitation && <p className="mt-2 leading-6">{fact.limitation}</p>}</details>
      <ul className="mt-2 space-y-1 text-xs">{graph.sources.filter(s => fact.sourceIds.includes(s.id) && s.url.startsWith("https://")).map(s => <li key={s.id}><a className="break-words text-cyan-200 hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a><p className="mt-1 text-slate-400">{text("Source published", "资料发布日期")}: {s.sourceDate ?? text("Unknown", "未注明")}</p></li>)}</ul>
      {fact.eventDate && <p className="mt-1 text-xs text-slate-400">{text("Event date", "事件日期")}: {fact.eventDate}</p>}
    </div>)}
  </div>;
}

export function CompanyResearchPanel({ companyId, initialGraph }: { companyId: string; initialGraph?: KnowledgeGraph }) {
  const { text, chinese, locale } = useLocale();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(initialGraph ?? null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (initialGraph) return;
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setGraph).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [initialGraph, retry]);
  useEffect(() => {
    if (!graph || !window.location.hash.startsWith("#relationship-")) return;
    const frame = requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [graph]);
  if (!graph) return <section className="my-6 text-sm text-slate-400" role="status">{error ? <>{text("Company relationships are unavailable.", "公司关系暂时无法加载。 ")}<button className="text-cyan-200 underline" onClick={() => { setError(false); setRetry(v => v + 1); }}>{text("Retry", "重试")}</button></> : text("Loading company research…", "正在加载公司研究…")}</section>;
  const node = graph.nodes.find(n => n.kind === "COMPANY" && n.id === companyId);
  if (!node) return <section className="my-6 text-sm text-slate-400"><CompanyFollowButton companyId={companyId} /><p className="mt-3">{text("AI relationship research has not yet been verified for this company.", "该公司的 AI 产业关系尚待核实。")}</p></section>;
  const edges = graph.relationships.filter(e => e.type !== "PARTICIPATES_IN" && (e.source === companyId || e.target === companyId));
  return <section id="company-relationships" aria-label={text("AI supply-chain research", "AI 产业链研究")} className="my-6 scroll-mt-24 rounded-2xl border border-cyan-500/25 bg-slate-900/50 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-cyan-100">{text("AI supply-chain role", "AI 产业链角色")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{companyRole(node, chinese)}</p></div><CompanyFollowButton companyId={companyId} /></div>
    <nav className="mt-4 flex flex-wrap gap-4 text-sm text-cyan-200" aria-label={text("Research sections", "研究分区")}><a href="#company-relationships">{text("Relationships & evidence", "关系与证据")}</a><a href="#company-information">{text("Company information", "公司资料")}</a><Link href={`/?company=${encodeURIComponent(companyId)}`}>{text("Explore in 3D map", "在 3D 图谱中探索")}</Link></nav>
    <p className="mt-4 text-xs leading-5 text-slate-400">{text("Evidence may describe historical activity or future plans. Source publication dates do not confirm current deliveries.", "资料可能描述历史情况或未来计划，资料发布日期不代表当前已交付。")}</p>
    {edges.length === 0 && <p className="mt-5 text-sm text-slate-400">{text("No verified relationships available yet.", "暂无已核实的关系资料。")}</p>}
    {(["suppliers", "customers", "partners"] as const).map(group => {
      const rows = edges.filter(e => relationshipGroup(e, companyId) === group);
      if (!rows.length) return null;
      return <section key={group} className="mt-6"><h3 className="font-semibold text-slate-100">{group === "suppliers" ? text("Suppliers", "供应商") : group === "customers" ? text("Customers", "客户") : text("Partners & technology", "合作伙伴与技术协作")} <span className="text-slate-500">{rows.length}</span></h3><div className="mt-3 grid gap-3 md:grid-cols-2">{rows.map(edge => {
        const other = graph.nodes.find(n => n.id === (edge.source === companyId ? edge.target : edge.source));
        return <article id={relationAnchor(edge.id)} key={edge.id} className="min-w-0 scroll-mt-28 rounded-xl border border-white/10 p-4 target:border-cyan-300">{other && <Link className="font-semibold text-cyan-200 hover:underline" href={researchCompanyUrl(other)}>{companyName(other, locale)} <span className="text-xs text-slate-400">{other.symbol}</span></Link>}<RelationshipEvidence edge={edge} graph={graph} /></article>;
      })}</div></section>;
    })}
  </section>;
}
