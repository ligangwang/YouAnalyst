"use client";

import { UiText, useUiText } from "@/components/ui-text";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { INDUSTRY_SEGMENTS } from "@/lib/industry-graph/catalog";
import { isMapTicker } from "@/lib/industry-graph/directory";
import { buildIndustryGraph, RELATIONSHIP_LABELS, selectNeighborhood, type IndustryGraph, type IndustryNode } from "@/lib/industry-graph/model";
import { trackEvent } from "@/lib/analytics";
import { layoutIndustryGraph } from "@/lib/industry-graph/layout";
import { CompanyCallActions } from "./company-call-actions";
import styles from "./industry-graph-home.module.css";
import marketStyles from "./all-markets-overview.module.css";
import { useLocale } from "./providers/locale-provider";

const EMPTY_GRAPH = buildIndustryGraph({}, []);
function subscribeToCompactView(listener: () => void) {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
export function IndustryGraphHome({ initialTicker = "", embedded = false }: { initialTicker?: string; embedded?: boolean }) {
  const Container = embedded ? "section" : "main";
  const { text } = useLocale();
  const ui = useUiText();
  const [graph, setGraph] = useState<IndustryGraph>(EMPTY_GRAPH);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [requestedTicker, setRequestedTicker] = useState(initialTicker.toUpperCase());
  const [pageCursors, setPageCursors] = useState<string[]>([""]);
  const cursor = pageCursors.at(-1)!;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [type, setType] = useState("all");
  const [categories, setCategories] = useState(false);
  const compact = useSyncExternalStore(subscribeToCompactView, () => window.matchMedia("(max-width: 760px)").matches, () => false);
  const [preferredMode, setMode] = useState<"map" | "list" | null>(null);
  const mode = preferredMode ?? (compact ? "list" : "map");
  const [allConnections, setAllConnections] = useState(false);
  const [panelWidth, setPanelWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState("");
  const viewed = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const panel = canvasRef.current ?? panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => { canvasRef.current?.scrollTo(0, 0); }, [roots, allConnections]);

  useEffect(() => {
    if ((selectedId || edgeId) && window.matchMedia("(max-width: 760px)").matches) {
      detailRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [selectedId, edgeId]);

  useEffect(() => {
    if (!viewed.current) {
      trackEvent("industry_graph_view");
      viewed.current = true;
    }
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const params = new URLSearchParams();
    if (requestedTicker) params.set("company", requestedTicker);
    if (cursor) params.set("after", cursor);
    void fetch(`/api/industry-graph${params.size ? `?${params}` : ""}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Graph unavailable");
        const payload = await response.json() as IndustryGraph;
        if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges) || !Array.isArray(payload.coveredTickers)) throw new Error("Invalid graph");
        if (disposed) return;
        setGraph(payload);
        setStatus("ready");
        const initial = payload.nodes.find((node) => node.ticker === requestedTicker);
        setSelectedId(initial?.id ?? null); setRoots(initial ? [initial.id] : []); setEdgeId(null);
        setNotice(requestedTicker && !initial ? `No company or published filing coverage found for ${requestedTicker}.` : "");
        trackEvent("industry_graph_load", { node_count: payload.nodes.length, edge_count: payload.edges.length, coverage_count: payload.coveredTickers.length });
      })
      .catch(() => {
        if (disposed) return;
        setStatus("error");
        trackEvent("industry_graph_error");
      }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
  }, [attempt, requestedTicker, cursor]);

  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const selected = selectedId ? nodesById.get(selectedId) : null;
  const selectedEdge = graph.edges.find((edge) => edge.id === edgeId);
  const overview = roots.length === 0 && !allConnections;
  const visible = useMemo(() => selectNeighborhood(graph, roots, type, categories, overview), [graph, roots, type, categories, overview]);
  const searchResults = query.trim() ? graph.nodes.filter((node) => node.kind !== "category" &&
    `${node.name} ${node.ticker ?? ""} ${node.aliases?.join(" ") ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];
  const connections = selected ? visible.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const { columns, positions, width: chartWidth, height: chartHeight } = layoutIndustryGraph(visible.nodes, panelWidth);

  function selectCompany(node: IndustryNode, focus = false) {
    if (node.ticker && !graph.coveredTickers.includes(node.ticker) && node.ticker !== requestedTicker) {
      setRequestedTicker(node.ticker); setStatus("loading");
    }
    setSelectedId(node.id); setEdgeId(null); setNotice("");
    if (focus || !roots.length) { setRoots([node.id]); setZoom(1); }
    trackEvent("graph_company_select", { ticker: node.ticker ?? undefined, node_kind: node.kind, segment: node.segment });
  }
  function reset() {
    if (requestedTicker) { setRequestedTicker(""); setStatus("loading"); }
    setRoots([]); setSelectedId(null); setEdgeId(null); setType("all"); setCategories(false); setZoom(1); setQuery(""); setAllConnections(false); setNotice("");
    trackEvent("graph_view_change", { action: "industry_overview", view_mode: mode });
  }
  function openEvidence(id: string) {
    setEdgeId(id);
    const edge = graph.edges.find((item) => item.id === id);
    trackEvent("graph_evidence_open", { relationship_type: edge?.type });
  }
  function edgeLabel(edge: IndustryGraph["edges"][number]) {
    return `${nodesById.get(edge.source)?.name ?? "Company"} ${RELATIONSHIP_LABELS[edge.type]} ${nodesById.get(edge.target)?.name ?? "Company"}`;
  }

  const selectedInEvidence = !selectedEdge || selected?.id === selectedEdge.source || selected?.id === selectedEdge.target;
  const saveTarget = selectedInEvidence && selected?.ticker ? selected : selectedEdge ? graph.nodes.find((node) => node.ticker === selectedEdge.evidence[0]?.issuerTicker) : null;
  const saveTicker = saveTarget?.ticker;
  const saveCard = saveTicker ? <section className={styles.saveCard} aria-label={ui("Track company")}>
    <CompanyCallActions ticker={saveTicker} compact entryPoint={selectedEdge ? "evidence" : "company"} />
  </section> : null;

  return (
    <Container className={styles.page} id={embedded ? "us-company-connections" : undefined} aria-labelledby={embedded ? "us-connections-heading" : undefined}>
      {embedded ? <header className={marketStyles.sectionHeading}><h2 id="us-connections-heading">{text("US company connections", "美股公司关系")}</h2><p>{text("Explore company connections and check the supporting evidence.", "探索公司之间的联系，核查来源证据。")}</p></header> : <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}><UiText text={"COMPANY RELATIONSHIPS"} /></p>
          <h1><UiText text={"Explore company connections."} /></h1>
          <p><UiText text={"Research the businesses behind a stock. Check the filing evidence, form your view, and track your bullish or bearish calls."} /></p>
        </div>
        <span className={styles.pill}><UiText text={"Early access · Sources linked"} /></span>
      </header>}

      {!embedded && <section className={styles.getStarted} aria-label={ui("Start your research")}>
        <div><strong><UiText text={"Start with a stock you know."} /></strong><p><UiText text={"Explore its customers, suppliers and competitors before deciding what you think."} /></p></div>
        <Link href="/companies" onClick={() => trackEvent("graph_discovery_open", { entry_point: "homepage", action: "company_search" })}><UiText text={"Find a company →"} /></Link>
        <Link href="/how-it-works"><UiText text={"How tracking works"} /></Link>
      </section>}

      <section className={styles.workspace} aria-label={ui("AI industry explorer")}>
        <div className={styles.toolbar}>
          <form className={styles.search} role="search" onSubmit={(event) => {
            event.preventDefault();
            trackEvent("graph_search", { result_count: searchResults.length });
            if (searchResults[0]) { selectCompany(searchResults[0], true); setQuery(""); }
            else {
              const ticker = query.trim().replace(/^\$/, "").toUpperCase();
              if (isMapTicker(ticker)) { setRequestedTicker(ticker); setStatus("loading"); setAttempt((value) => value + 1); setQuery(""); }
            }
          }}>
            <label className={styles.srOnly} htmlFor="graph-search"><UiText text={"Find a company in the map"} /></label>
            <input id="graph-search" type="search" autoComplete="off" placeholder={ui("Find a company or ticker…")} value={query}
              onChange={(event) => setQuery(event.target.value)} aria-controls="graph-search-results" />
            <button type="submit"><UiText text={"Find"} /></button>
            {query.trim() && <div id="graph-search-results" className={styles.results} aria-label={ui("Company search results")}>
              {searchResults.length ? searchResults.map((node) => <button type="button" key={node.id} onClick={() => {
                trackEvent("graph_search", { result_count: searchResults.length }); selectCompany(node, true); setQuery("");
              }}><strong>{node.name}</strong><span>{node.ticker ?? <UiText text={"Filing mention"} />}</span></button>) :
                <p><UiText text={"No match on this page. Enter a ticker to open its map, or "} /><Link href="/companies"><UiText text={"search all companies"} /></Link>.</p>}
            </div>}
          </form>
          <div className={styles.starters}><span><UiText text={"Companies"} /></span>{graph.coveredTickers.slice(0, 3).map((ticker) =>
            <button key={ticker} type="button" onClick={() => { const node = graph.nodes.find((item) => item.ticker === ticker); if (node) selectCompany(node, true); }}>{ticker}</button>)}</div>
          <div className={styles.switcher} aria-label={ui("Display mode")}>{(["map", "list"] as const).map((value) =>
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); trackEvent("graph_view_change", { view_mode: value }); }}>{value === "map" ? <UiText text={"Map"} /> : <UiText text={"List"} />}</button>)}</div>
        </div>
        {(pageCursors.length > 1 || graph.nextCursor) && <nav className={styles.filters} aria-label={ui("Company pages")}>
          <button type="button" disabled={pageCursors.length === 1 || status === "loading"} onClick={() => { reset(); setStatus("loading"); setPageCursors((pages) => pages.slice(0, -1)); }}><UiText text={"Previous companies"} /></button>
          <span><UiText text={"Page "} />{pageCursors.length}</span>
          <button type="button" disabled={!graph.nextCursor || status === "loading"} onClick={() => { reset(); setStatus("loading"); setPageCursors((pages) => [...pages, graph.nextCursor!]); }}><UiText text={"Next companies"} /></button>
        </nav>}
        <div className={styles.filters}>
          <label><UiText text={"Connections "} /><select aria-label={ui("Relationship type")} value={type} onChange={(event) => {
            setType(event.target.value); setEdgeId(null); trackEvent("graph_filter", { relationship_type: event.target.value });
          }}><option value="all"><UiText text={"All types"} /></option>{Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => <option key={value} value={value}><UiText text={label} /></option>)}</select></label>
          {!overview && <label><input type="checkbox" checked={categories} onChange={(event) => { setCategories(event.target.checked); setEdgeId(null); trackEvent("graph_filter", { action: event.target.checked ? "show_categories" : "hide_categories" }); }} /><UiText text={" Include groups"} /></label>}
          <button type="button" onClick={reset}><UiText text={"Reset map"} /></button>
          <span className={styles.count} aria-live="polite">{status === "loading" ? <UiText text={"Loading coverage…"} /> : status === "error" ? <UiText text={"Coverage unavailable"} /> : <UiText text={`${visible.nodes.length} nodes · ${visible.edges.length} connection${visible.edges.length === 1 ? "" : "s"}`} />}</span>
        </div>
        <div className={styles.scope} aria-label={ui("Map scope")}>
          <div><strong>{overview ? <UiText text={"Industry overview"} /> : roots.length ? <UiText text={"Company connections"} /> : <UiText text={"All filing connections"} />}</strong>
            <p>{overview ? <UiText text={"Start with the main companies. Select one to reveal suppliers, customers and other filing mentions."} /> : <UiText text={"Select a connection to read its filing evidence. Focus on a company to reduce the map."} />}</p></div>
          {overview ? <button type="button" onClick={() => {
            setAllConnections(true); setZoom(1); trackEvent("graph_view_change", { action: "all_connections", view_mode: mode });
          }}><UiText text={"Show all connections"} /></button> : <button type="button" onClick={reset}><UiText text={"Back to industry overview"} /></button>}
        </div>
        <div className={styles.body}>
          <div ref={panelRef} className={styles.canvasPanel}>
            {status !== "ready" && <div role="status" className={styles.status}>
              {status === "loading" ? <UiText text={"Loading filing relationships…"} /> : <><UiText text={"Filing relationships are temporarily unavailable. "} /><button type="button" onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}><UiText text={"Try again"} /></button></>}
            </div>}
            {status === "ready" && !graph.edges.length && <div role="status" className={styles.status}><UiText text={"No published relationships on this page. Published filing relationships will appear here as coverage is added."} /></div>}
            {status === "ready" && graph.edges.length > 0 && !visible.edges.length && <div role="status" className={styles.status}>{overview ? <UiText text={"No connections between starting companies match this view. Select a company or show all connections to explore filing mentions."} /> : <UiText text={"No connections match this view. Try another company or change the filters."} />}</div>}
            {mode === "map" ? <>
              <div ref={canvasRef} className={styles.canvas} tabIndex={0} role="region" aria-label={ui("Scrollable industry map. Select a company or use List view.")}>
                <svg width={chartWidth * zoom} height={chartHeight * zoom} viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-label={ui("AI industry company relationships")} role="group">
                  <defs><marker id="industry-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#67e8f9" /></marker></defs>
                  {columns.map((column) => <g key={column.id}><rect x={column.x - 88} y={column.top + 12} width="176" height={column.height - 24} rx="12" fill={column.color} opacity="0.035" /><text x={column.x} y={column.top + 42} textAnchor="middle" fill={column.color} fontSize="11" fontWeight="600">{<UiText text={column.label} />}</text></g>)}
                  {visible.edges.map((edge) => {
                    const source = positions.get(edge.source)!; const target = positions.get(edge.target)!;
                    const sameColumn = source.x === target.x;
                    const sign = source.x <= target.x ? 1 : -1;
                    const sx = sameColumn ? source.x + 74 : source.x + sign * 74;
                    const tx = sameColumn ? target.x + 74 : target.x - sign * 74;
                    const curve = sameColumn ? `M ${sx} ${source.y} C ${sx + 18} ${source.y}, ${tx + 18} ${target.y}, ${tx} ${target.y}` :
                      `M ${sx} ${source.y} C ${(sx + tx) / 2} ${source.y}, ${(sx + tx) / 2} ${target.y}, ${tx} ${target.y}`;
                    const emphasized = edgeId === edge.id || selectedId === edge.source || selectedId === edge.target;
                    return <g key={edge.id} role="button" tabIndex={0} aria-label={ui(`Evidence: ${edgeLabel(edge)}`)} className={styles.edge}
                      onClick={() => openEvidence(edge.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEvidence(edge.id); } }}>
                      <title>{<UiText text={edgeLabel(edge)} />}</title><path d={curve} fill="none" stroke="transparent" strokeWidth="14" />
                      <path d={curve} fill="none" stroke={emphasized ? "#67e8f9" : "#52758c"} strokeWidth={emphasized ? 2 : 1.3} opacity={selectedId && !emphasized ? 0.2 : 0.7} markerEnd="url(#industry-arrow)" markerStart={edge.bidirectional ? "url(#industry-arrow)" : undefined} />
                    </g>;
                  })}
                  {visible.nodes.map((node) => {
                    const point = positions.get(node.id)!;
                    return <g key={node.id} role="button" tabIndex={0} aria-label={ui(`Explore ${node.name}${node.ticker ? ` (${node.ticker})` : ""}`)} className={styles.node}
                      onClick={() => selectCompany(node)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectCompany(node); } }}>
                      <title>{node.name} · {node.kind === "research" ? <UiText text={"Published industry research"} /> : node.kind === "coverage" ? <UiText text={"Coverage pending"} /> : node.kind === "issuer" ? <UiText text={"Filing issuer"} /> : node.kind === "category" ? <UiText text={"Group mentioned in filing"} /> : <UiText text={"Unresolved company mention"} />}</title>
                      <rect x={point.x - 74} y={point.y - 28} width="148" height="56" rx="10" fill={selectedId === node.id ? "#123345" : "#0d1d2b"} stroke={point.color} strokeOpacity={selectedId === node.id ? 1 : 0.5} strokeWidth={selectedId === node.id ? 2 : 1} strokeDasharray={node.kind === "issuer" ? undefined : "4 3"} />
                      <circle cx={point.x - 59} cy={point.y - 8} r="3" fill={point.color} />
                      <text x={point.x - 49} y={point.y - 4} fill="#f1f5f9" fontSize="12" fontWeight="600">{node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}</text>
                      <text x={point.x - 59} y={point.y + 15} fill="#9badbd" fontSize="10">{node.kind === "coverage" ? <UiText text={`${node.ticker} · coverage pending`} /> : node.ticker ?? (node.kind === "category" ? <UiText text={"Group / category"} /> : <UiText text={"Unresolved mention"} />)}</text>
                    </g>;
                  })}
                </svg>
              </div>
              <div className={styles.canvasTools}><span><UiText text={"Scroll to explore · arrows follow the relationship label"} /></span><div>
                <button type="button" aria-label={ui("Fit map")} onClick={() => setZoom(Math.min(1, (canvasRef.current?.clientWidth ?? chartWidth) / chartWidth))}><UiText text={"Fit"} /></button>
                <button type="button" aria-label={ui("Zoom out")} disabled={zoom <= 0.6} onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))}>−</button>
                <button type="button" aria-label={ui("Reset zoom")} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                <button type="button" aria-label={ui("Zoom in")} disabled={zoom >= 1.8} onClick={() => setZoom((value) => Math.min(1.8, value + 0.2))}>+</button>
              </div></div>
            </> : <div className={styles.list} aria-label={ui("Industry relationship list")}>
              <h2><UiText text={"Companies in this view"} /></h2><div className={styles.companyList}>{visible.nodes.map((node) => <button key={node.id} type="button" aria-label={ui(`Explore ${node.name}${node.ticker ? ` (${node.ticker})` : ""}`)} onClick={() => selectCompany(node)}>{node.name}<span>{node.ticker ?? node.kind}</span></button>)}</div>
              <h2><UiText text={"Filing connections"} /></h2>{visible.edges.length ? visible.edges.map((edge) => <button className={styles.connection} key={edge.id} type="button" onClick={() => openEvidence(edge.id)}>{<UiText text={edgeLabel(edge)} />}<span><UiText text={"Read evidence →"} /></span></button>) : <p><UiText text={"No connections in this view yet."} /></p>}
            </div>}
            <div className={styles.legend}><span><UiText text={"Solid outline: filing issuer"} /></span><span><UiText text={"Dashed: research, pending coverage, mention or group"} /></span><span><UiText text={"AI-assisted connections · inspect the sources"} /></span></div>
          </div>

          <aside ref={detailRef} className={styles.detail} aria-label={ui("Company and relationship details")} aria-live="polite">
            {selectedEdge ? <>
              <button className={styles.back} type="button" onClick={() => setEdgeId(null)}><UiText text={"← Back to company"} /></button>
              <p className={styles.eyebrow}><UiText text={"RELATIONSHIP EVIDENCE"} /></p><h2>{<UiText text={edgeLabel(selectedEdge)} />}</h2>
              <p className={styles.muted}>{selectedEdge.evidence.some(e => e.sourceKind === "web") ? <UiText text={"Includes reviewed industry research. Summaries are AI-generated, not source quotations. Read the linked sources for context."} /> : <UiText text={"Extracted by AI from a filing. Read the source to assess the claim and its context."} />}</p>
              {selectedEdge.evidence.map((evidence) => <article key={evidence.id} className={styles.evidence}>
                <p className={styles.evidenceMeta}>{evidence.issuerTicker} · {evidence.sourceKind === "web" ? <UiText text={"Industry research"} /> : "10-K"} · {evidence.filingDate}</p>
                {evidence.sourceKind === "web" ? <p>{evidence.quote}</p> : <blockquote>“{evidence.quote}”</blockquote>}
                {evidence.qualityReview && <p className={styles.matchNote}><UiText text={"Evidence reviewed "} />{evidence.qualityReview.reviewedAt}: {evidence.qualityReview.reason}</p>}
                {evidence.nameMatched && <p className={styles.matchNote}><UiText text={"Company connection is based on a name match, pending identity review."} /></p>}
                <a href={evidence.filingUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("graph_source_open", { ticker: evidence.issuerTicker, relationship_type: selectedEdge.type })}>{evidence.sourceKind === "web" ? `${evidence.sourceTitle ?? "Read source"} ↗` : <UiText text={"Read SEC filing ↗"} />}</a>
              </article>)}
              {saveCard}
            </> : selected ? <>
              <p className={styles.eyebrow}>{INDUSTRY_SEGMENTS.find((item) => item.id === selected.segment)?.label}</p>
              <h2>{selected.name}</h2><p className={styles.muted}>{selected.ticker ?? (selected.kind === "category" ? <UiText text={"Group mentioned in a filing"} /> : <UiText text={"Company mentioned in a filing"} />)}</p>
              {selected.ticker && <Link className={styles.companyLink} href={`/ticker/${encodeURIComponent(selected.ticker)}`} onClick={() => trackEvent("graph_company_open", { ticker: selected.ticker! })}><UiText text={"View "} />{selected.ticker}<UiText text={" company page →"} /></Link>}
              {selected.kind === "mention" && <p className={styles.matchNote}><UiText text={"Identity unresolved. This mention has not been merged with a company record."} /></p>}
              {selected.kind === "coverage" && <p className={styles.matchNote}>{selected.filingForm === "20-F"
                ? <UiText text={"This company files a 20-F. Its own annual filing has not been added yet. Connections shown here come from other companies’ filings and use provisional name matches."} />
                : <UiText text={"This company’s own filing has not been added yet. Connections from other issuers may appear as provisional name matches."} />}</p>}
              {saveCard}
              {(roots.length !== 1 || roots[0] !== selected.id) && <button className={styles.primary} type="button" onClick={() => {
                selectCompany(selected, true); trackEvent("graph_view_change", { action: "focus_company", ticker: selected.ticker ?? undefined, view_mode: mode });
              }}><UiText text={"Focus on this company"} /></button>}
              <button className={styles.primary} type="button" disabled={roots.includes(selected.id) || roots.length >= 8 || !["issuer", "research"].includes(selected.kind)} onClick={() => {
                setRoots((previous) => [...previous, selected.id]); trackEvent("graph_expand", { ticker: selected.ticker ?? undefined });
              }}>{roots.includes(selected.id) ? <UiText text={"Connections in view"} /> : <UiText text={"Expand connections"} />}</button>
              {roots.length >= 8 && <p className={styles.muted}><UiText text={"Eight companies expanded. Reset the map to explore another area."} /></p>}
              <h3>{connections.length}<UiText text={" connection"} />{connections.length === 1 ? "" : <UiText text={"s"} />}<UiText text={" in this view"} /></h3>
              {connections.map((edge) => <button className={styles.connection} key={edge.id} type="button" onClick={() => openEvidence(edge.id)}>{<UiText text={edgeLabel(edge)} />}<span>{edge.evidence.length}<UiText text={" source"} />{edge.evidence.length === 1 ? "" : <UiText text={"s"} />} →</span></button>)}
              {!connections.length && <p className={styles.muted}><UiText text={"Try changing the filters or choosing another company."} /></p>}
              {selected.ticker && <div className={styles.actions}>
                <Link href={`/predictions/new?ticker=${encodeURIComponent(selected.ticker)}`} onClick={() => trackEvent("graph_predict_click", { ticker: selected.ticker! })}><UiText text={"Make a prediction →"} /></Link>
                <button type="button" onClick={async () => {
                  try { const url = new URL("/", window.location.origin); url.searchParams.set("company", selected.ticker!); await navigator.clipboard.writeText(url.href); setNotice("View link copied."); trackEvent("graph_save_view", { ticker: selected.ticker!, method: "copy_link" }); }
                  catch { setNotice("Could not copy. Open the company page to continue exploring."); }
                }}><UiText text={"Copy view link"} /></button>
              </div>}
            </> : <>
              <p className={styles.eyebrow}><UiText text={"FROM SILICON TO INFRASTRUCTURE"} /></p><h2><UiText text={"Where does your company fit?"} /></h2>
              <p><UiText text={"Choose a company to trace its suppliers, customers and competitors."} /></p>
              <ol className={styles.steps}><li><span>01</span><UiText text={"Pick a company or search above."} /></li><li><span>02</span><UiText text={"Follow a connection to its evidence."} /></li><li><span>03</span><UiText text={"Expand a neighbor to go deeper."} /></li></ol>
              <div className={styles.coverage}><strong>{graph.coveredTickers.length} / {graph.nodes.filter((node) => node.ticker).length}</strong><span><UiText text={"companies on this page with published extraction"} /></span></div>
              <p className={styles.muted}><UiText text={"Connections combine US 10-K filings and reviewed industry research where available. Coverage is limited to the sources loaded on this page, not the full market. Source dates do not establish whether a relationship remains active."} /></p>
            </>}
            {notice && <p role="status">{<UiText text={notice} />}</p>}
            <div className={styles.feedback}><p><UiText text={"What’s missing from this map?"} /></p><Link href="/feedback" onClick={() => trackEvent("graph_feedback_click")}><UiText text={"Help shape YouAnalyst ↗"} /></Link></div>
          </aside>
        </div>
        <div className={styles.bottom}><span>{graph.updatedAt ? <UiText text={`Extraction updated ${graph.updatedAt.slice(0, 10)} · evidence dates vary`} /> : <UiText text={"Coverage is being built"} />}{graph.omittedEdges > 0 ? <UiText text={` · ${graph.omittedEdges} connections outside this bounded preview`} /> : ""}{(graph.withheldEdges ?? 0) > 0 ? <UiText text={` · ${graph.withheldEdges} claims withheld after evidence review`} /> : ""}</span><Link href="/companies"><UiText text={"Search all companies →"} /></Link></div>
      </section>
    </Container>
  );
}
