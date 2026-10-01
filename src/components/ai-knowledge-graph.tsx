"use client";

import { PrivateValuationDisplay } from "./private-valuation";
import { marketCapDescription } from "@/lib/knowledge-graph/market-cap";

import { lazy, Suspense, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "./providers/locale-provider";
import { companyName, filterGraph, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { companyPageUrl } from "@/lib/market-companies/routes";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "@/lib/knowledge-graph/sectors";
import { companyGeographyLabel } from "@/lib/market-companies/identity";
import { IndustryCompanyTable } from "./industry-company-views";
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';
import { companySectors, INDUSTRY_VIEWS, LEGACY_VERTICAL_VIEW, parseIndustryView, type IndustryView } from "@/lib/knowledge-graph/views";
import {IndustryHierarchy} from "./industry-hierarchy";
import {NavigationSettings} from "./navigation-settings";
import {UniverseMusic, UniverseMusicToggle} from "./universe-music";
import { IndustryStructure } from "./industry-tree";
import { CompanyFollowButton, useCompanyFollows } from "./company-follow-button";
import { CompanyCountryFlag } from "./company-country-flag";
import { CompanyNameEditor } from "./company-name-editor";
import { AiMapDirectory } from "./ai-map-directory";
import { relationLabels } from "@/lib/knowledge-graph/relationship-labels";
import { RelationshipEvidence } from "./company-research-panel";
import { BusinessEventEvidence } from "./company-change-card";
import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import { relationshipVerification, verificationLabel } from "@/lib/knowledge-graph/relationship-status";
import { trackEvent } from "@/lib/analytics";
import styles from "./ai-knowledge-graph.module.css";
import { useNodeCardPosition } from './use-node-card-position';
import { useCardDismiss } from './use-card-dismiss';
import cardFade from './card-fade.module.css';

const CompanyGraph3D = lazy(() => import("./company-graph-3d"));
const subscribeView = (notify: () => void) => {
  window.addEventListener("storage", notify); window.addEventListener("popstate", notify); window.addEventListener("industry-view-changed", notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener("popstate", notify); window.removeEventListener("industry-view-changed", notify); };
};
const EMPTY: KnowledgeGraph = { nodes: [], relationships: [], sources: [], asOf: "" };
function ViewIcon({ view }: { view: IndustryView }) {
  return <svg style={view==='hierarchy'?{transform:'rotate(-90deg)'}:undefined} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {view === "table" ? <><path d="M9 5h12M9 12h12M9 19h12" /><path d="M3 5h1M3 12h1M3 19h1" /></> : (view === "tree" || view === "hierarchy") ? <><rect x="9" y="2" width="6" height="5" rx="1" /><path d="M12 7v5M5 17v-5h14v5" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /></> : <><path d="m6 7 10-2M6 7l5 11M18 5l-7 13" /><circle cx="5" cy="6" r="3" /><circle cx="19" cy="4" r="3" /><circle cx="11" cy="19" r="3" /></>}
  </svg>;
}
export function AiKnowledgeGraph({ initialCompany = "", initialQuery = "", initialEdge = "", initialEvent = "", startingPoints, introduction, allowedRelationshipIds }: { initialCompany?: string; initialQuery?: string; initialEdge?: string; initialEvent?: string; startingPoints?: React.ReactNode; introduction?: React.ReactNode; allowedRelationshipIds?: string[] }) {
  const { text, locale } = useLocale();
  const defaultView: IndustryView = "graph";
  const view = useSyncExternalStore(subscribeView, () => {
    const requested = parseIndustryView(new URLSearchParams(window.location.search).get("view"));
    if (requested) return requested;
    if (initialEdge || initialEvent || allowedRelationshipIds) return "graph";
    try { const saved = parseIndustryView(localStorage.getItem("ya-industry-view")); if (saved) return saved; } catch { /* Storage is optional. */ }
    return defaultView;
  }, () => defaultView);
  const viewId = useId();
  const marketFilter = useIndustryBrowseParam('listingMarket', 'all');
  const setMarketFilter = (value: string) => updateIndustryBrowse({listingMarket:value}, true);
  const roleFilter = useIndustryBrowseParam('role');
  const setRoleFilter = (value: string) => updateIndustryBrowse({role:value}, true);
  const onlyFollowed = useIndustryBrowseParam('following') === '1';
  const setOnlyFollowed = (value: boolean) => updateIndustryBrowse({following:value?'1':''}, true);
  const follows = useCompanyFollows();
  function changeView(next: IndustryView) {
    if(next==="tree")setCardHost({tree:"vertical",reveal:false});
    if(next==="hierarchy")setCardHost({tree:"horizontal",reveal:false});
    try { localStorage.setItem("ya-industry-view", next); } catch { /* URL still preserves the selection. */ }
    const url = new URL(window.location.href); url.searchParams.set("view", next); window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event("industry-view-changed"));
    if (next !== view) trackEvent("graph_view_change", {view_mode: next});
  }
  const treeView=view==='tree'||view==='hierarchy';
  // Selection is shared between views; the active chart owns its card.
  const [cardHost, setCardHost] = useState<{tree:"vertical"|"horizontal";reveal:boolean}>({tree:"vertical",reveal:true});
  useEffect(() => {
    // Legacy vertical links and preferences open the Tree tab;
    // rewrite them so the URL and the saved preference name the tab that is shown.
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") === LEGACY_VERTICAL_VIEW) { url.searchParams.set("view", "tree"); window.history.replaceState(null, "", url); }
    try { if (localStorage.getItem("ya-industry-view") === LEGACY_VERTICAL_VIEW) localStorage.setItem("ya-industry-view", "tree"); } catch { /* Storage is optional. */ }
  }, []);
  const [activeEdge, setActiveEdge] = useState(initialEdge);
  const [eventId, setEventId] = useState(initialEvent);
  const [sectorFocus, setSectorFocus] = useState("");
  const [sectorsExpanded, setSectorsExpanded] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const sectorControlsId = useId();
  const [cameraRequest, setCameraRequest] = useState(0);
  const [graph, setGraph] = useState(EMPTY);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const query = useIndustryBrowseParam('q', '', initialQuery);
  const setQuery = (value: string) => updateIndustryBrowse({q:value}, true);
  const [selected, setSelected] = useState(initialCompany ? (initialCompany.includes(":") ? initialCompany.toUpperCase() : `US:${initialCompany.toUpperCase()}`) : "");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { setGraph(data); setStatus("ready"); }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [retry]);
  const scoped = useMemo(() => {
    if (!allowedRelationshipIds) return graph;
    const relationships = graph.relationships.filter(e=>allowedRelationshipIds.includes(e.id));
    const ids = new Set(relationships.flatMap(e=>[e.source,e.target]));
    return {...graph, relationships, nodes:graph.nodes.filter(n=>ids.has(n.id))};
  }, [graph, allowedRelationshipIds]);
  // Keep tree layout inputs stable when opening/closing a company card or following.
  const treeCompanies = useMemo(() => scoped.nodes.filter(n => n.kind === 'COMPANY'), [scoped.nodes]);
  // Follow status refreshes asynchronously (and on window focus). It does not
  // filter the graph, so it must not replace its layout and cancel the camera.
  const graphVisible = useMemo(() => filterGraph(scoped, ["US", "CN_A", "GLOBAL"], query), [scoped, query]);
  const visible = useMemo(() => {
    if (view === "tree" || view === "hierarchy") return scoped;
    if (view === "graph") return graphVisible;
    const filtered = filterGraph(scoped, ["US", "CN_A", "GLOBAL"], query);
    const companies = filtered.nodes.filter(n => n.kind === "COMPANY" && (marketFilter === "all" || n.market === marketFilter) && (!roleFilter || companySectors(n).some(s => s.id === roleFilter)) && (!onlyFollowed || follows.ids.includes(n.id)));
    const ids = new Set(companies.map(n => n.id));
    const stages = new Set(companies.flatMap(n => n.stageIds ?? []).map(id => "stage:" + id));
    return {...filtered, nodes:[...filtered.nodes.filter(n => n.kind === "STAGE" && stages.has(n.id)), ...companies], relationships:filtered.relationships.filter(e => ids.has(e.source) && (ids.has(e.target) || stages.has(e.target)))};
  }, [scoped, graphVisible, query, marketFilter, roleFilter, onlyFollowed, follows.ids, view]);
  const companies = visible.nodes.filter(n => n.kind === "COMPANY");
  const matches = useMemo(() => filterGraph(visible, ["US", "CN_A", "GLOBAL"], query).nodes.filter(n => n.kind === "COMPANY"), [visible, query]);
  const [browseQuery, setBrowseQuery] = useState("");
  const browseMatches = useMemo(() => filterGraph(visible, ["US", "CN_A", "GLOBAL"], browseQuery).nodes.filter(n => n.kind === "COMPANY").sort((a,b)=>companyName(a,locale).localeCompare(companyName(b,locale),locale)), [visible,browseQuery,locale]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sectorIds = new Set(scoped.nodes.filter(n => n.kind === "COMPANY").map(n => companySector(n).id));
  const [reset, setReset] = useState(0);
  const [showAllEdges, setShowAllEdges] = useState(false);
  const company = scoped.nodes.find(n => n.id === selected && n.kind === "COMPANY");
  const detailCard=useNodeCardPosition(company?.id??'','graph',view==='graph'&&Boolean(company));
  const relations = company ? scoped.relationships.filter(e => e.source === company.id || e.target === company.id) : [];
  const label = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n?.kind === "STAGE" ? text(n.labels?.en ?? n.label ?? id, n.labels?.["zh-CN"] ?? n.label ?? id) : n ? companyName(n,locale) : id; };
  const cardDismiss=useCardDismiss();
  function selectCompany(id: string, fromTree?: "vertical"|"horizontal") {
    if(!id&&selected){cardDismiss.dismiss(()=>applyCompanySelection('',fromTree));return;}
    cardDismiss.cancel();
    applyCompanySelection(id,fromTree);
  }
  function applyCompanySelection(id: string, fromTree?: "vertical"|"horizontal") {
    setCardHost(fromTree ? {tree:fromTree,reveal:false} : {tree:"vertical",reveal:true});
    if(id)setCameraRequest(value=>value+1);
    setSelected(id);
    setSectorFocus("");
    if(id&&!treeView) workspaceRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    setActiveEdge("");
    setEventId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("event");
    url.searchParams.delete("relationship");
    if (id) url.searchParams.set("company", id); else url.searchParams.delete("company");
    window.history.replaceState(null, "", url);
  }
  const nodeSelection=useRef({selected,tree:cardHost.tree,closing:cardDismiss.closing,selectCompany});
  useLayoutEffect(()=>{nodeSelection.current={selected,tree:cardHost.tree,closing:cardDismiss.closing,selectCompany};});
  function selectNode(id: string, fromTree?: "vertical"|"horizontal") {
    // Canvas/Html roots can commit later than the card; always use its current selection.
    const current=nodeSelection.current;
    const sameCard=!fromTree||fromTree===current.tree;
    current.selectCompany(id === current.selected&&sameCard&&!current.closing ? "" : id, fromTree);
  }
  function resetGraphView() {
    cardDismiss.cancel();
    applyCompanySelection("");
    setQuery("");
    setBrowseQuery("");
    setSearchExpanded(false);
    setSectorsExpanded(false);
    setShowAllEdges(false);
    setReset(value => value + 1);
  }
  function openConnection(id: string, reached?: string) {
    if(!id){setActiveEdge("");return;}
    const edge = graph.relationships.find(e => e.id === id); if (!edge || edge.type === "PARTICIPATES_IN") return;
    cardDismiss.cancel();
    const nextCompany=reached ?? (selected===edge.source||selected===edge.target?selected:edge.source);
    setSelected(nextCompany);
    setCardHost({tree:"vertical",reveal:true});
    setSectorFocus("");
    setQuery("");
    changeView("graph");
    setActiveEdge(id);
    setEventId("");
    trackEvent("company_evidence_view", {entry_point:"map_connection"});
    const url=new URL(window.location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("event");
    url.searchParams.delete("relationship");
    url.searchParams.set("company",nextCompany);
    url.searchParams.set("relationship", id);
    window.history.replaceState(null,"",url);
  }
  function toggleSector(id: string) {
    const next = sectorFocus === id ? "" : id;
    cardDismiss.cancel();
    applyCompanySelection("");
    if(next)setCameraRequest(value=>value+1);
    setSectorFocus(next);
    setSectorsExpanded(false);
  }
  const sourceLinks = (ids: string[]) => graph.sources.filter(s => ids.includes(s.id) && /^https:\/\//.test(s.url)).map(s => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗{s.sourceDate && <time className={styles.sourceDate} dateTime={s.sourceDate}>{s.sourceDate}</time>}</a>);
  const Container = allowedRelationshipIds ? "section" : "main";
  const Heading = allowedRelationshipIds ? "h2" : "h1";
  return <><Container className={styles.page}>
    <header className={styles.header}><div className={styles.mapIdentity}><div className={styles.titleRow}><div className={styles.thesisPicker}><label htmlFor={viewId+'-thesis'}>{text('Theme','投资主题')}</label><Heading className={styles.mapHeading}>{text("AI Industry Map", "AI 产业图谱")}</Heading><select id={viewId+'-thesis'} defaultValue="ai" aria-label={text('Investment theme','投资主题')}><option value="ai">AI</option></select></div><details className={styles.mapHelp}><summary aria-label={text('About the AI Industry Map','关于 AI 产业图谱')}>ⓘ</summary><p>{text("Explore AI stocks, companies, and supply-chain relationships.", "探索 AI 公司、股票与产业链关系。")}</p></details></div>
    </div>
    {(view==="graph"||view==="tree")&&<NavigationSettings/>}
    <div className={styles.viewTabs} role="tablist" aria-label={text("Industry views", "产业视图")}>
      {([['graph','Relationship graph','关系图谱'],['tree','Industry tree','产业树'],['hierarchy','Company hierarchy','公司层级图'],['table','Company list','公司列表']] as const).map(([id,en,zh]) => <button key={id} type="button" role="tab" aria-label={text(en,zh)} id={viewId+'-'+id} aria-selected={view===id} aria-controls={viewId+'-panel'} tabIndex={view===id?0:-1} onClick={()=>changeView(id)} onKeyDown={e=>{const ids=INDUSTRY_VIEWS;let next:IndustryView|undefined;if(e.key==='ArrowRight')next=ids[(ids.indexOf(id)+1)%ids.length];if(e.key==='ArrowLeft')next=ids[(ids.indexOf(id)+ids.length-1)%ids.length];if(e.key==='Home')next=ids[0];if(e.key==='End')next=ids[ids.length-1];if(next){e.preventDefault();changeView(next);document.getElementById(viewId+'-'+next)?.focus();}}}><ViewIcon view={id} />{text(id==='table'?'List':id==='tree'?'Tree':id==='hierarchy'?'Hierarchy':'Graph',id==='table'?'列表':id==='tree'?'树状图':id==='hierarchy'?'层级图':'关系图')}</button>)}
    </div></header>
    {startingPoints}
    <UniverseMusic active={status==="ready"&&(view==="graph"||(view==="tree"&&companies.length>0))}/>
    <div hidden={view!=='table'}><div className={styles.sharedFilters}>
    <div className={styles.controls}>
      <svg className={styles.searchIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input aria-label={text("Search companies", "搜索公司")} placeholder={text("Search companies or tickers…", "搜索公司或股票代码…")} value={query} onChange={e => setQuery(e.target.value)}/>
    </div>
    <button type="button" className={styles.filterToggle} aria-expanded={filtersExpanded} onClick={()=>setFiltersExpanded(value=>!value)}>{text('Filters','筛选')} {[marketFilter!=='all',Boolean(roleFilter),onlyFollowed].filter(Boolean).length || ''}</button>
    <div className={styles.filterOptions} data-expanded={filtersExpanded}>
    <label>{text("Listing market", "上市市场")}<select aria-label={text("Listing market", "上市市场")} value={marketFilter} onChange={e=>setMarketFilter(e.target.value)}><option value="all">{text("All markets", "全部市场")}</option><option value="US">{text("US-listed", "美股")}</option><option value="CN_A">{text("China A-shares", "A股")}</option><option value="GLOBAL">{text("Other / private", "其他／非上市")}</option></select></label>
    <label>{text("Industry role", "产业环节")}<select aria-label={text("Industry role", "产业环节")} value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">{text("All roles", "全部环节")}</option>{[...GRAPH_SECTORS,OTHER_SECTOR].filter(s=>sectorIds.has(s.id)||scoped.nodes.some(n=>n.kind==='COMPANY'&&companySectors(n).some(role=>role.id===s.id))).map(s=><option key={s.id} value={s.id}>{text(s.en,s.zh)}</option>)}</select></label>
    <label className={styles.followFilter}><input type="checkbox" checked={onlyFollowed} onChange={e=>setOnlyFollowed(e.target.checked)}/>{text("Following only", "仅看关注")}</label></div>
    {(query || marketFilter!=='all' || roleFilter || onlyFollowed) && <button className={styles.filterReset} onClick={()=>updateIndustryBrowse({q:'',listingMarket:'',role:'',following:''},true)}>{text("Clear filters", "清除筛选")}</button>}
    </div>
    {onlyFollowed && !follows.user && <p className={styles.filterNotice}>{text("Sign in and follow companies to use this filter.", "登录并关注公司后，可使用此筛选。")}</p>}
    {onlyFollowed && follows.user && !follows.ready && <p className={styles.filterNotice} role="status">{follows.error?<button onClick={()=>void follows.refresh()}>{text("Could not load follows. Retry", "关注列表加载失败，重试")}</button>:text("Loading followed companies…", "正在加载关注公司…")}</p>}
    </div>
    {status === "loading" ? <p className={styles.empty} role="status">{text("Loading the knowledge graph…", "正在加载知识图谱…")}</p> : status === "error" ? <div className={styles.empty} role="alert">{text("The graph could not be loaded.", "暂时无法加载图谱。")} <button onClick={() => { setStatus("loading"); setRetry(n => n + 1); }}>{text("Try again", "重试")}</button></div> : !companies.length && view!=='graph' ? <p className={styles.empty}>{text("No matching companies.", "没有匹配的公司。")}</p> : <div ref={workspaceRef} data-view={view} id={viewId+"-panel"} role="tabpanel" aria-labelledby={viewId+"-"+view} className={`${styles.workspace} ${company && !treeView ? styles.withDetail : ""}`}>
      <div className={styles.viewContent}>
    {view === "graph" && status === "ready" && <div className={styles.graphTools} onKeyDown={e=>{if(e.key==='Escape'){setSectorsExpanded(false);document.getElementById(sectorControlsId+"-toggle")?.focus();}}}><button type="button" className={styles.graphSearchToggle} aria-expanded={searchExpanded || Boolean(query)} onClick={()=>setSearchExpanded(value=>!value)}>{text('Find company','查找公司')}</button><button type="button" className={styles.sectorToggle} id={sectorControlsId+"-toggle"} aria-expanded={sectorsExpanded} aria-controls={sectorControlsId} onClick={()=>setSectorsExpanded(value=>!value)}>{text("Sectors", "产业环节")}{sectorFocus && <> · {text((GRAPH_SECTORS.find(s=>s.id===sectorFocus)??OTHER_SECTOR).en,(GRAPH_SECTORS.find(s=>s.id===sectorFocus)??OTHER_SECTOR).zh)}</>} <span aria-hidden="true">{sectorsExpanded?"−":"+"}</span></button><div id={sectorControlsId} className={styles.sectorLegend} data-expanded={sectorsExpanded} role="group" aria-label={text("Colors by primary AI sector", "按主要 AI 产业环节着色")}><span>{text("Highlight sector", "突出显示产业环节")}</span>{[...GRAPH_SECTORS, OTHER_SECTOR].filter(s => sectorIds.has(s.id)).map(s => <button key={s.id} type="button" aria-pressed={sectorFocus === s.id} onClick={() => {toggleSector(s.id);document.getElementById(sectorControlsId+"-toggle")?.focus();}} style={{ color: s.color }}><i aria-hidden="true" style={{ background: s.color }}/>{text(s.en, s.zh)}</button>)}</div><button type="button" className={styles.graphSearchToggle} aria-pressed={showAllEdges} onClick={()=>setShowAllEdges(value=>!value)}>{text("All connections", "全部关系")}{showAllEdges ? " ✓" : ""}</button><p className={styles.interactionHint}><span className={styles.pointerHint}>{text(selected || showAllEdges ? "Hover a line to preview · Click for evidence" : "Click a company to explore its connections", selected || showAllEdges ? "悬停连线预览关系 · 点击查看依据" : "点击公司，探索产业关联")}</span><span className={styles.touchHint}>{text(selected || showAllEdges ? "Tap a line for relationship evidence" : "Tap a company to explore its connections", selected || showAllEdges ? "点按连线查看关系依据" : "点击公司，探索产业关联")}</span><span style={{display:"block",marginTop:4,fontSize:".85em",opacity:.75}}>{text("Solid: other statuses · Dashed: announced · Open evidence for details", "实线：其他状态 · 虚线：已宣布 · 具体进展请查看依据")}</span></p><button className={styles.graphSearchToggle} onClick={resetGraphView}>{text("Reset view", "重置视图")}</button></div>}
    {view==='graph' && (searchExpanded || query) && <div className={styles.graphSearch}><input aria-label={text('Search companies','搜索公司')} placeholder={text('Company or ticker…','公司或股票代码…')} value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>{setQuery('');setSearchExpanded(false);}}>{text('Clear filters','清除筛选')}</button></div>}
    {view==='graph' && query.trim() && <section className={styles.searchResults} aria-label={text("Search results", "搜索结果")}>
      {matches.length ? matches.map(n => <button key={n.id} onClick={() => selectCompany(n.id)}>{companyName(n,locale)} · {n.symbol}</button>) : <p>{text("No matching companies.", "没有匹配的公司。")}</p>}
    </section>}

      <div hidden={view!=='table'}><IndustryCompanyTable companies={companies} selected={selected} onSelect={selectCompany} followedIds={follows.ids}/></div>
      {/* Keep the initialized 3D tree mounted across tabs. */}
      <div hidden={view!=='tree'} className={styles.structureStack}>
        <IndustryStructure musicControls vertical active={view==='tree'} companies={treeCompanies} selected={selected} onSelect={id=>selectNode(id,"vertical")} closing={cardDismiss.closing} showCard={cardHost.tree==="vertical"} revealCard={cardHost.reveal} followedIds={follows.ids}/>
      </div>
      {view==='hierarchy'&&<IndustryHierarchy companies={treeCompanies} selected={selected} closing={cardDismiss.closing} onSelect={id=>selectNode(id,'horizontal')}/>}
      {view==='graph' && <Suspense fallback={<div className={styles.canvas3d}><p className={styles.empty} role="status">{text("Loading graph…", "正在加载图谱…")}</p><UniverseMusicToggle/></div>}><CompanyGraph3D musicControls showAllEdges={showAllEdges} hideReset cameraRequest={cameraRequest} graph={visible} sectorFocus={sectorFocus} activeEdge={activeEdge} onSelectEdge={openConnection} selected={company?.id ?? ""} onSelect={selectNode} reset={reset} onReset={resetGraphView}/></Suspense>}
      </div>
      {company && !treeView && <aside ref={detailCard} className={`${styles.detail} ${cardFade.card}`} data-closing={cardDismiss.closing} inert={cardDismiss.closing} aria-label={text("Company details", "公司详情")} onKeyDown={e=>{if(e.key==='Escape')selectCompany('');}}>
        <div className={styles.detailHeader} data-card-drag={view==='graph'?true:undefined} tabIndex={view==='graph'?0:undefined} aria-label={view==='graph'?text("Move company card","移动公司卡片"):undefined}>
          <span className={styles.sectorBadge}><i aria-hidden="true" style={{ background: companySector(company).color }}/>{text(companySector(company).en, companySector(company).zh)}</span>
          <button className={styles.clear} onClick={() => selectCompany("")} aria-label={text("Clear selection", "取消选择")}>×</button>
        </div>
        <h2><CompanyCountryFlag country={company.country} locale={locale}/>{companyName(company,locale)}</h2>
        <CompanyNameEditor key={`${company.id}-${locale}`} company={company} onSaved={updated => setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === updated.id ? { ...node, ...updated } : node) }))} />
        {company.symbol && <p className={styles.eyebrow}>{company.symbol}</p>}
        <p>{companyGeographyLabel(company, locale)}</p>
        {company.privateValuation && <PrivateValuationDisplay valuation={company.privateValuation}/>}
        {company.marketCap && <p>{marketCapDescription(company.marketCap, locale)}</p>}
        <p>{company.summary}</p>
        <CompanyFollowButton companyId={company.id} /><a className={styles.profileLink} href={companyPageUrl(company.id.startsWith("US:") ? company.symbol ?? company.id.slice(3) : company.id, company.market)}>{text("Company profile", "公司详情")} →</a>
        {eventId && curatedEvents.filter(e => e.id === eventId && e.companyIds.includes(company.id)).map(e => <section key={e.id} className={styles.connectionFocus} aria-label={text("Selected event evidence", "选中事件证据")}><BusinessEventEvidence event={e} /></section>)}
        {activeEdge && graph.relationships.filter(e => e.id === activeEdge && (e.source === company.id || e.target === company.id)).map(e => <section key={e.id} className={styles.connectionFocus} aria-label={text("Selected connection", "选中关系")}><h3>{text(...(relationLabels[e.type] ?? [e.type, e.type]) as [string, string])}</h3><p>{label(e.source)} → {label(e.target)}</p><RelationshipEvidence edge={e} graph={graph} /><button onClick={() => selectCompany(e.target === company.id ? e.source : e.target)}>{text("Explore", "探索")} {label(e.target === company.id ? e.source : e.target)} →</button></section>)}
        <details key={`${company.id}-connections`} className={styles.detailSection} open>
          <summary>{text("Connections & roles", "关系与产业归属")} <span>{relations.length}</span></summary>
          {relations.length === 0 && <p>{text("No documented connections yet.", "暂无已收录关系。")}</p>}
          {relations.map(e => <article key={e.id}>
            <span>{text(...(relationLabels[e.type] ?? [e.type, e.type]) as [string, string])}{e.commercialStatus === "ANNOUNCED" ? text(" · Announced", " · 已宣布") : ""}</span>
            {e.type === "PARTICIPATES_IN" ? <strong>{label(e.source)} → {label(e.target)}</strong> : <button className={styles.connectionLink} onClick={() => openConnection(e.id, company.id)}>{label(e.source)} → {label(e.target)}</button>}
            <p>{e.type !== "PARTICIPATES_IN" && <small>{verificationLabel(relationshipVerification(e), locale === "zh-CN")} · {text("Last reviewed", "最近复核")}: {e.researchReviewedAt ?? text("Not recorded", "未记录")}</small>}</p><p>{e.summary}</p><div className={styles.sources}>{sourceLinks(e.sourceIds)}</div>
          </article>)}
        </details>
        <details key={`${company.id}-sources`} className={styles.detailSection}>
          <summary>{text("Research sources", "研究来源")}</summary>
          <div className={styles.sources}>{sourceLinks(company.sourceIds ?? [])}</div>
        </details>
      </aside>}
    </div>}
    <div className={styles.legend}><span role="status">{status === "ready" ? <>{visible.nodes.filter(n => n.kind === "COMPANY").length} {text("companies", "家公司")} · {visible.relationships.filter(e => e.type !== "PARTICIPATES_IN").length} {text("documented connections", "项已收录关系")}</> : text(status === "loading" ? "Loading company and connection totals…" : "Company and connection totals unavailable", status === "loading" ? "正在加载公司与关系数量…" : "暂时无法获取公司与关系数量")}</span></div>
    {introduction}
    {view === "graph" && status === "ready" && <details className={styles.companyBrowser}><summary>{text("Browse companies", "浏览公司")} · {visible.nodes.filter(n=>n.kind==="COMPANY").length}</summary>
      <input aria-label={text("Find a company in the list", "在列表中查找公司")} placeholder={text("Name, ticker or business…", "名称、代码或业务…")} value={browseQuery} onChange={e=>setBrowseQuery(e.target.value)}/>
      <div className={styles.companyList}>{browseMatches.map(n=><button key={n.id} onClick={()=>selectCompany(n.id)}><span style={{color:companySector(n).color}}>{companyName(n,locale)}</span><small>{n.symbol} · {text(companySector(n).en,companySector(n).zh)}</small></button>)}{!browseMatches.length && <p>{text("No matching companies.", "没有匹配的公司。")}</p>}</div>
    </details>}
  </Container>{!allowedRelationshipIds && !treeView && <AiMapDirectory graph={graph} status={status} onRetry={() => { setStatus("loading"); setRetry(n => n + 1); }} />}</>;
}
