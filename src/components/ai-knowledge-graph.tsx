"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { companyName, filterGraph, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { companyPageUrl } from "@/lib/market-companies/routes";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "@/lib/knowledge-graph/sectors";
import { companyGeographyLabel } from "@/lib/market-companies/identity";
import { AiMapDirectory } from "./ai-map-directory";
import { relationLabels } from "@/lib/knowledge-graph/relationship-labels";
import styles from "./ai-knowledge-graph.module.css";

const CompanyGraph3D = lazy(() => import("./company-graph-3d"));
const EMPTY: KnowledgeGraph = { nodes: [], relationships: [], sources: [], asOf: "" };
export function AiKnowledgeGraph({ initialCompany = "", initialQuery = "" }: { initialCompany?: string; initialQuery?: string }) {
  const { text, locale } = useLocale();
  const [activeEdge, setActiveEdge] = useState("");
  const [sectorFocus, setSectorFocus] = useState("");
  const [graph, setGraph] = useState(EMPTY);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(initialCompany ? (initialCompany.includes(":") ? initialCompany.toUpperCase() : `US:${initialCompany.toUpperCase()}`) : "");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { setGraph(data); setStatus("ready"); }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [retry]);
  const visible = graph;
  const matches = useMemo(() => filterGraph(graph, ["US", "CN_A", "GLOBAL"], query).nodes.filter(n => n.kind === "COMPANY"), [graph, query]);
  const [browseQuery, setBrowseQuery] = useState("");
  const browseMatches = useMemo(() => filterGraph(graph, ["US", "CN_A", "GLOBAL"], browseQuery).nodes.filter(n => n.kind === "COMPANY").sort((a,b)=>companyName(a,locale).localeCompare(companyName(b,locale),locale)), [graph,browseQuery,locale]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sectorIds = new Set(visible.nodes.filter(n => n.kind === "COMPANY").map(n => companySector(n).id));
  const [reset, setReset] = useState(0);
  const company = visible.nodes.find(n => n.id === selected && n.kind === "COMPANY");
  const relations = company ? graph.relationships.filter(e => e.source === company.id || e.target === company.id) : [];
  const label = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n?.kind === "STAGE" ? text(n.labels?.en ?? n.label ?? id, n.labels?.["zh-CN"] ?? n.label ?? id) : n ? companyName(n,locale) : id; };
  function selectCompany(id: string) {
    setSelected(id);
    setSectorFocus("");
    workspaceRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    setQuery("");
    setActiveEdge("");
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    if (id) url.searchParams.set("company", id); else url.searchParams.delete("company");
    window.history.replaceState(null, "", url);
  }
  function openConnection(id: string, reached?: string) {
    const edge = graph.relationships.find(e => e.id === id); if (!edge || edge.type === "PARTICIPATES_IN") return;
    selectCompany(reached ?? edge.source); setActiveEdge(id);
  }
  function toggleSector(id: string) {
    const next = sectorFocus === id ? "" : id;
    selectCompany("");
    setSectorFocus(next);
  }
  const sourceLinks = (ids: string[]) => graph.sources.filter(s => ids.includes(s.id) && /^https:\/\//.test(s.url)).map(s => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗{s.sourceDate && <time className={styles.sourceDate} dateTime={s.sourceDate}>{s.sourceDate}</time>}</a>);
  return <><main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{text("EXPLORE", "探索")}</p><h1>{text("AI Industry Map", "AI 产业图谱")}</h1><p>{text("Explore AI stocks, companies, and supply-chain relationships.", "探索 AI 公司、股票与产业链关系。")}</p></div></header>
    <div className={styles.controls}>
      <svg className={styles.searchIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input aria-label={text("Search companies", "搜索公司")} placeholder={text("Search companies or tickers…", "搜索公司或股票代码…")} value={query} onChange={e => { const value = e.target.value; setQuery(value); const url = new URL(window.location.href); if (value) url.searchParams.set("q", value); else url.searchParams.delete("q"); window.history.replaceState(null, "", url); }}/>
    </div>
    {query.trim() && <section className={styles.searchResults} aria-label={text("Search results", "搜索结果")}>
      {matches.length ? matches.map(n => <button key={n.id} onClick={() => selectCompany(n.id)}>{companyName(n,locale)} · {n.symbol}</button>) : <p>{text("No matching companies.", "没有匹配的公司。")}</p>}
    </section>}
    {status === "ready" && sectorIds.size > 0 && <div className={styles.sectorLegend} role="group" aria-label={text("Colors by primary AI sector", "按主要 AI 产业环节着色")}><span>{text("Sector", "产业环节")}</span>{[...GRAPH_SECTORS, OTHER_SECTOR].filter(s => sectorIds.has(s.id)).map(s => <button key={s.id} type="button" aria-pressed={sectorFocus === s.id} onClick={() => toggleSector(s.id)} style={{ color: s.color }}><i aria-hidden="true" style={{ background: s.color }}/>{text(s.en, s.zh)}</button>)}</div>}
    {status === "loading" ? <p className={styles.empty} role="status">{text("Loading the knowledge graph…", "正在加载知识图谱…")}</p> : status === "error" ? <div className={styles.empty} role="alert">{text("The graph could not be loaded.", "暂时无法加载图谱。")} <button onClick={() => { setStatus("loading"); setRetry(n => n + 1); }}>{text("Try again", "重试")}</button></div> : !visible.nodes.length ? <p className={styles.empty}>{text("No matching companies.", "没有匹配的公司。")}</p> : <div ref={workspaceRef} className={`${styles.workspace} ${company ? styles.withDetail : ""}`}>
      <Suspense fallback={<p className={styles.empty} role="status">{text("Loading graph…", "正在加载图谱…")}</p>}><CompanyGraph3D graph={visible} sectorFocus={sectorFocus} onSelectSector={toggleSector} activeEdge={activeEdge} onSelectEdge={openConnection} selected={company?.id ?? ""} onSelect={selectCompany} reset={reset} onReset={() => { selectCompany(""); setReset(n => n + 1); }}/></Suspense>
      {company && <aside className={styles.detail} aria-label={text("Company details", "公司详情")}>
        <div className={styles.detailHeader}>
          <span className={styles.sectorBadge}><i aria-hidden="true" style={{ background: companySector(company).color }}/>{text(companySector(company).en, companySector(company).zh)}</span>
          <button className={styles.clear} onClick={() => selectCompany("")} aria-label={text("Clear selection", "取消选择")}>×</button>
        </div>
        <h2>{companyName(company,locale)}</h2>
        {company.symbol && <p className={styles.eyebrow}>{company.symbol}</p>}
        <p>{companyGeographyLabel(company, locale)}</p>
        <p>{company.summary}</p>
        <a className={styles.profileLink} href={companyPageUrl(company.id.startsWith("US:") ? company.symbol ?? company.id.slice(3) : company.id, company.market)}>{text("Company profile", "公司详情")} →</a>
        {activeEdge && graph.relationships.filter(e => e.id === activeEdge).map(e => <section key={e.id} className={styles.connectionFocus} aria-label={text("Selected connection", "选中关系")}><h3>{text(...(relationLabels[e.type] ?? [e.type, e.type]) as [string, string])}</h3><p>{label(e.source)} → {label(e.target)}</p><p>{e.summary}</p><div className={styles.sources}>{sourceLinks(e.sourceIds)}</div><button onClick={() => selectCompany(e.target === company.id ? e.source : e.target)}>{text("Explore", "探索")} {label(e.target === company.id ? e.source : e.target)} →</button></section>)}
        <details key={`${company.id}-connections`} className={styles.detailSection} open>
          <summary>{text("Connections & roles", "关系与产业归属")} <span>{relations.length}</span></summary>
          {relations.length === 0 && <p>{text("No documented connections yet.", "暂无已收录关系。")}</p>}
          {relations.map(e => <article key={e.id}>
            <span>{text(...(relationLabels[e.type] ?? [e.type, e.type]) as [string, string])}{e.commercialStatus === "ANNOUNCED" ? text(" · Announced", " · 已宣布") : ""}</span>
            {e.type === "PARTICIPATES_IN" ? <strong>{label(e.source)} → {label(e.target)}</strong> : <button className={styles.connectionLink} onClick={() => openConnection(e.id, company.id)}>{label(e.source)} → {label(e.target)}</button>}
            <p>{e.summary}</p><div className={styles.sources}>{sourceLinks(e.sourceIds)}</div>
          </article>)}
        </details>
        <details key={`${company.id}-sources`} className={styles.detailSection}>
          <summary>{text("Research sources", "研究来源")}</summary>
          <div className={styles.sources}>{sourceLinks(company.sourceIds ?? [])}</div>
          {company.market === "US" && <a className={styles.profileLink} href={`/map?view=filings&company=${encodeURIComponent(company.symbol ?? "")}`}>{text("Filing explorer", "财报关系探索")} →</a>}
        </details>
      </aside>}
    </div>}
    <div className={styles.legend}><span role="status">{visible.nodes.filter(n => n.kind === "COMPANY").length} {text("companies", "家公司")} · {visible.relationships.filter(e => e.type !== "PARTICIPATES_IN").length} {text("documented connections", "项已收录关系")}</span></div>
    {status === "ready" && <details className={styles.companyBrowser}><summary>{text("Browse companies", "浏览公司")} · {graph.nodes.filter(n=>n.kind==="COMPANY").length}</summary>
      <input aria-label={text("Find a company in the list", "在列表中查找公司")} placeholder={text("Name, ticker or business…", "名称、代码或业务…")} value={browseQuery} onChange={e=>setBrowseQuery(e.target.value)}/>
      <div className={styles.companyList}>{browseMatches.map(n=><button key={n.id} onClick={()=>selectCompany(n.id)}><span style={{color:companySector(n).color}}>{companyName(n,locale)}</span><small>{n.symbol} · {text(companySector(n).en,companySector(n).zh)}</small></button>)}{!browseMatches.length && <p>{text("No matching companies.", "没有匹配的公司。")}</p>}</div>
    </details>}
  </main><AiMapDirectory graph={graph} status={status} onRetry={() => { setStatus("loading"); setRetry(n => n + 1); }} /></>;
}

