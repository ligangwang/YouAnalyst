"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { filterGraph, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { companyPageUrl } from "@/lib/market-companies/routes";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "@/lib/knowledge-graph/sectors";
import { companyGeographyLabel } from "@/lib/market-companies/identity";
import { useOptionalAuth } from "./providers/auth-provider";
import { connectionJourney, recentConnections } from "@/lib/knowledge-graph/discovery";
import { AiMapDirectory } from "./ai-map-directory";
import styles from "./ai-knowledge-graph.module.css";

const CompanyGraph3D = lazy(() => import("./company-graph-3d"));
const EMPTY: KnowledgeGraph = { nodes: [], relationships: [], sources: [], asOf: "" };
const relationLabels: Record<string, [string, string]> = {
  COMPETES_WITH: ["Competitor", "竞争对手"], CUSTOMER_OF: ["Customer", "客户"], PARTICIPATES_IN: ["Industry role", "产业归属"], SUPPLIER_OF: ["Supplies", "供应"], PARTNER_OF: ["Partner", "合作伙伴"], ECOSYSTEM_PARTNER_OF: ["Ecosystem partner", "生态伙伴"], INTEGRATES_TECHNOLOGY_FROM: ["Integrates technology from", "集成其技术"], PLANNED_ADOPTER_OF: ["Planned adoption", "计划采用"], ENERGY_AGREEMENT_WITH: ["Energy agreement", "能源协议"],
};
export function AiKnowledgeGraph({ initialCompany = "", initialQuery = "" }: { initialCompany?: string; initialQuery?: string }) {
  const { text, locale } = useLocale();
  const auth = useOptionalAuth();
  const getIdToken = auth?.getIdToken;
  const uid = auth?.user?.uid;
  const followUser = useRef(uid);
  const [followed, setFollowed] = useState<string[]>([]);
  const [followReady, setFollowReady] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState(false);
  const [activeEdge, setActiveEdge] = useState("");
  const [journey, setJourney] = useState<{ edgeId: string; companyId: string }[]>([]);
  const [journeyStep, setJourneyStep] = useState(0);
  const [updatesOpen, setUpdatesOpen] = useState(false);
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
  useEffect(() => {
    let active = true;
    followUser.current = uid;
    setFollowBusy(false);
    setFollowReady(false); setFollowed([]); setFollowError(false);
    if (uid && getIdToken) void getIdToken().then(token => fetch("/api/map-follows", { headers: { Authorization: `Bearer ${token}` } })).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (active) { setFollowed(data.companyIds); setFollowReady(true); } }).catch(() => { if (active) setFollowError(true); });
    return () => { active = false; };
  }, [uid, getIdToken]);
  async function toggleFollow(id: string) {
    if (!auth?.user || followBusy || !followReady) return;
    const requestedUser = uid;
    setFollowBusy(true); setFollowError(false);
    try {
      const token = await auth.getIdToken();
      const response = await fetch("/api/map-follows", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ companyId: id, follow: !followed.includes(id) }) });
      if (!response.ok) throw new Error();
      const data = await response.json(); if (followUser.current === requestedUser) setFollowed(data.companyIds);
    } catch { if (followUser.current === requestedUser) setFollowError(true); } finally { if (followUser.current === requestedUser) setFollowBusy(false); }
  }
  const recent = useMemo(() => recentConnections(graph), [graph]);
  const highlighted = useMemo(() => recent.map(e => e.id), [recent]);
  const visible = useMemo(() => filterGraph(graph, ["US", "CN_A", "GLOBAL"], query), [graph, query]);
  const sectorIds = new Set(visible.nodes.filter(n => n.kind === "COMPANY").map(n => companySector(n).id));
  const [reset, setReset] = useState(0);
  const company = visible.nodes.find(n => n.id === selected && n.kind === "COMPANY");
  const relations = company ? graph.relationships.filter(e => e.source === company.id || e.target === company.id) : [];
  const label = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n?.kind === "STAGE" ? text(n.labels?.en ?? n.label ?? id, n.labels?.["zh-CN"] ?? n.label ?? id) : n?.name ?? id; };
  function selectCompany(id: string) {
    setSelected(id);
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
  function startJourney(id: string) {
    let current = id;
    const path = connectionJourney(graph, id).map(e => { current = e.source === current ? e.target : e.source; return { edgeId: e.id, companyId: current }; });
    setJourney(path); setJourneyStep(0); if (path.length) openConnection(path[0].edgeId, path[0].companyId);
  }
  const sourceLinks = (ids: string[]) => graph.sources.filter(s => ids.includes(s.id) && /^https:\/\//.test(s.url)).map(s => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗{s.sourceDate && <time className={styles.sourceDate} dateTime={s.sourceDate}>{s.sourceDate}</time>}</a>);
  return <><main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{text("EXPLORE", "探索")}</p><h1>{text("AI Industry Map", "AI 产业图谱")}</h1><p>{text("Explore AI stocks, companies, and supply-chain relationships.", "探索 AI 公司、股票与产业链关系。")}</p></div></header>
    <div className={styles.controls}>
      <svg className={styles.searchIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input aria-label={text("Search companies", "搜索公司")} placeholder={text("Search companies or tickers…", "搜索公司或股票代码…")} value={query} onChange={e => { const value = e.target.value; setQuery(value); const url = new URL(window.location.href); if (value) url.searchParams.set("q", value); else url.searchParams.delete("q"); window.history.replaceState(null, "", url); }}/>
    </div>
    <div className={styles.discovery}>
      <details><summary>{text("Guided journeys", "探索路线")}</summary><p>{text("Follow documented connections, one company at a time.", "沿已收录关系，逐步探索公司。")}</p>
        {[["US:NVDA", "AI computing", "AI 算力"], ["US:TSM", "Chip manufacturing", "芯片制造"], ["US:VRT", "Data centre infrastructure", "数据中心基础设施"]].filter(([id]) => connectionJourney(graph, id).length).map(([id, en, zh]) => <button key={id} onClick={() => startJourney(id)}>{text(en, zh)} →</button>)}
      </details>
      <button onClick={() => setUpdatesOpen(!updatesOpen)} aria-expanded={updatesOpen}>{text("What’s new", "最新关系")} {recent.length > 0 ? `· ${recent.length}` : ""}</button>
      {auth?.user && <details><summary>{text("Following", "已关注")} · {followed.length}</summary>
        {!followed.length && <p>{text("Follow a company from its map panel to find it here.", "在公司面板关注公司，即可在这里查看。")}</p>}
        {followed.map(id => graph.nodes.some(n => n.id === id && n.kind === "COMPANY") ? <button key={id} onClick={() => selectCompany(id)}>{label(id)}</button> : <span key={id}>{id} <button disabled={followBusy || !followReady} onClick={() => void toggleFollow(id)}>{text("Unfollow", "取消关注")}</button></span>)}
      </details>}
    </div>
    {updatesOpen && <section className={styles.updatePanel} aria-label={text("New connections", "最新关系")}><p>{text("Documented in the last 7 days. Highlights indicate when a connection was published here, not when the business relationship began.", "最近七天收录的关系。高亮表示本站收录时间，并非业务关系开始时间。")}</p>
      {!recent.length && <p>{text("No newly dated connections yet.", "暂无带收录日期的新关系。")}</p>}
      {recent.map(e => <button key={e.id} onClick={() => openConnection(e.id)}>{label(e.source)} → {label(e.target)}{followed.includes(e.source) || followed.includes(e.target) ? text(" · Following", " · 已关注") : ""}</button>)}
    </section>}
    {journey.length > 0 && <section className={styles.journey} aria-label={text("Guided journey", "探索路线")}><span>{text("Connection", "关系")} {journeyStep + 1} / {journey.length}</span><button disabled={journeyStep === 0} onClick={() => { const step = journeyStep - 1; setJourneyStep(step); openConnection(journey[step].edgeId, journey[step].companyId); }}>{text("Previous", "上一步")}</button><button disabled={journeyStep === journey.length - 1} onClick={() => { const step = journeyStep + 1; setJourneyStep(step); openConnection(journey[step].edgeId, journey[step].companyId); }}>{text("Next", "下一步")}</button><button onClick={() => { setJourney([]); setActiveEdge(""); }}>{text("End journey", "结束探索")}</button></section>}
    <div className={styles.legend}><span role="status">{visible.nodes.filter(n => n.kind === "COMPANY").length} {text("companies", "家公司")} · {visible.relationships.filter(e => e.type !== "PARTICIPATES_IN").length} {text("documented connections", "项已收录关系")}</span></div>
    {status === "ready" && sectorIds.size > 0 && <div className={styles.sectorLegend} role="group" aria-label={text("Colors by primary AI sector", "按主要 AI 产业环节着色")}><span>{text("Sector", "产业环节")}</span>{[...GRAPH_SECTORS, OTHER_SECTOR].filter(s => sectorIds.has(s.id)).map(s => <span key={s.id}><i aria-hidden="true" style={{ background: s.color }}/>{text(s.en, s.zh)}</span>)}</div>}
    {status === "loading" ? <p className={styles.empty} role="status">{text("Loading the knowledge graph…", "正在加载知识图谱…")}</p> : status === "error" ? <div className={styles.empty} role="alert">{text("The graph could not be loaded.", "暂时无法加载图谱。")} <button onClick={() => { setStatus("loading"); setRetry(n => n + 1); }}>{text("Try again", "重试")}</button></div> : !visible.nodes.length ? <p className={styles.empty}>{text("No matching companies.", "没有匹配的公司。")}</p> : <div className={`${styles.workspace} ${company ? styles.withDetail : ""}`}>
      <Suspense fallback={<p className={styles.empty} role="status">{text("Loading graph…", "正在加载图谱…")}</p>}><CompanyGraph3D graph={visible} highlightedEdges={highlighted} activeEdge={activeEdge} onSelectEdge={openConnection} selected={company?.id ?? ""} onSelect={selectCompany} reset={reset} onReset={() => { selectCompany(""); setJourney([]); setReset(n => n + 1); }}/></Suspense>
      {company && <aside className={styles.detail} aria-label={text("Company details", "公司详情")}>
        <div className={styles.detailHeader}>
          <span className={styles.sectorBadge}><i aria-hidden="true" style={{ background: companySector(company).color }}/>{text(companySector(company).en, companySector(company).zh)}</span>
          <button className={styles.clear} onClick={() => selectCompany("")} aria-label={text("Clear selection", "取消选择")}>×</button>
        </div>
        <h2>{company.name}</h2>
        {company.symbol && <p className={styles.eyebrow}>{company.symbol}</p>}
        <p>{companyGeographyLabel(company, locale)}</p>
        <p>{company.summary}</p>
        <a className={styles.profileLink} href={companyPageUrl(company.id.startsWith("US:") ? company.symbol ?? company.id.slice(3) : company.id, company.market)}>{text("Company profile", "公司详情")} →</a>
        <div className={styles.followAction}>
          {auth?.user ? <button disabled={!followReady || followBusy} onClick={() => void toggleFollow(company.id)}>{followed.includes(company.id) ? text("Unfollow", "取消关注") : text("Follow company", "关注公司")}</button> : <a href={`/auth?next=${encodeURIComponent(`/${locale === "zh-CN" ? "zh-cn" : "en"}?company=${encodeURIComponent(company.id)}`)}`}>{text("Sign in to follow", "登录后关注")}</a>}
          <small>{text("Find this company and its new connections here when you return.", "下次访问时，在此查看关注公司及其新关系。")}</small>
          {followError && <p role="alert">{text("Could not load or save follows. Please reload and try again.", "无法读取或保存关注，请刷新重试。")}</p>}
        </div>
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
  </main><AiMapDirectory graph={graph} status={status} onRetry={() => { setStatus("loading"); setRetry(n => n + 1); }} /></>;
}

