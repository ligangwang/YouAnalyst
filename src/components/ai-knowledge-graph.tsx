"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { filterGraph, layoutGraph, type KnowledgeGraph, type Market } from "@/lib/knowledge-graph/model";
import styles from "./ai-knowledge-graph.module.css";

const EMPTY: KnowledgeGraph = { nodes: [], relationships: [], sources: [], asOf: "" };
const relationLabels: Record<string, [string, string]> = {
  PARTICIPATES_IN: ["Industry role", "产业归属"], SUPPLIER_OF: ["Supplies", "供应"], PARTNER_OF: ["Partner", "合作伙伴"], ECOSYSTEM_PARTNER_OF: ["Ecosystem partner", "生态伙伴"], INTEGRATES_TECHNOLOGY_FROM: ["Integrates technology from", "集成其技术"], PLANNED_ADOPTER_OF: ["Planned adoption", "计划采用"], ENERGY_AGREEMENT_WITH: ["Energy agreement", "能源协议"],
};
export function AiKnowledgeGraph({ initialMarket = "ALL", initialCompany = "" }: { initialMarket?: "ALL" | "NONE" | Market; initialCompany?: string }) {
  const { text } = useLocale();
  const [graph, setGraph] = useState(EMPTY);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [markets, setMarkets] = useState<Market[]>(initialMarket === "ALL" ? ["US", "CN_A"] : initialMarket === "NONE" ? [] : [initialMarket]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initialCompany ? `US:${initialCompany.toUpperCase()}` : "");
  const [zoom, setZoom] = useState(75);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { setGraph(data); setStatus("ready"); }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [retry]);
  const visible = useMemo(() => filterGraph(graph, markets, query), [graph, markets, query]);
  const layout = useMemo(() => layoutGraph(visible.nodes), [visible.nodes]);
  const company = visible.nodes.find(n => n.id === selected && n.kind === "COMPANY");
  const relations = company ? graph.relationships.filter(e => e.source === company.id || e.target === company.id) : [];
  const activeEdges = company ? visible.relationships.filter(e => e.source === company.id || e.target === company.id) : visible.relationships.filter(e => e.type !== "PARTICIPATES_IN");
  const connected = new Set(activeEdges.flatMap(e => [e.source, e.target]));
  const label = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n?.kind === "STAGE" ? text(n.labels?.en ?? n.label ?? id, n.labels?.["zh-CN"] ?? n.label ?? id) : n?.name ?? id; };
  function toggle(market: Market) {
    const next = markets.includes(market) ? markets.filter(m => m !== market) : [...markets, market];
    setMarkets(next);
    const url = new URL(window.location.href);
    url.searchParams.set("market", next.length === 2 ? "ALL" : next[0] ?? "NONE");
    window.history.replaceState(null, "", url);
  }
  const sourceLinks = (ids: string[]) => graph.sources.filter(s => ids.includes(s.id) && /^https:\/\//.test(s.url)).map(s => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a>);
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{text("CONNECTED INTELLIGENCE", "产业 · 公司 · 联系")}</p><h1>{text("The AI landscape", "AI 产业知识图谱")}</h1><p>{text("Follow the companies shaping AI, from silicon to software.", "从芯片到应用，探索塑造 AI 的公司。")}</p></div><span className={styles.date}>{graph.asOf}</span></header>
    <div className={styles.controls}>
      <div className={styles.markets} aria-label={text("Markets", "市场")}><button aria-pressed={markets.includes("US")} onClick={() => toggle("US")}><i className={styles.us}/>{text("US stocks", "美股")}</button><button aria-pressed={markets.includes("CN_A")} onClick={() => toggle("CN_A")}><i className={styles.china}/>{text("A-shares", "A 股")}</button></div>
      <input aria-label={text("Search companies", "搜索公司")} placeholder={text("Search company or ticker…", "搜索公司或股票代码…")} value={query} onChange={e => setQuery(e.target.value)}/>
      <div className={styles.zoom}><button aria-label={text("Zoom out", "缩小")} disabled={zoom <= 40} onClick={() => setZoom(z => Math.max(40, z - 15))}>−</button><output>{zoom}%</output><button aria-label={text("Zoom in", "放大")} disabled={zoom >= 160} onClick={() => setZoom(z => Math.min(160, z + 15))}>+</button></div>
    </div>
    <div className={styles.legend}><span role="status">{visible.nodes.filter(n => n.kind === "COMPANY").length} {text("companies", "家公司")} · {visible.relationships.filter(e => e.type !== "PARTICIPATES_IN").length} {text("documented connections", "项已收录关系")}</span><span>{text("Solid: company relationship · Dashed: industry role", "实线：公司关系 · 虚线：产业归属")}</span></div>
    {status === "loading" ? <p className={styles.empty} role="status">{text("Loading the knowledge graph…", "正在加载知识图谱…")}</p> : status === "error" ? <div className={styles.empty} role="alert">{text("The graph could not be loaded.", "暂时无法加载图谱。")} <button onClick={() => { setStatus("loading"); setRetry(n => n + 1); }}>{text("Try again", "重试")}</button></div> : !visible.nodes.length ? <p className={styles.empty}>{!markets.length ? text("Turn on a market to explore its companies.", "开启一个市场以查看公司。") : text("No matching companies.", "没有匹配的公司。")}</p> : <div className={styles.workspace}>
      <div className={styles.canvas} tabIndex={0} aria-label={text("AI knowledge graph; scroll to explore", "AI 知识图谱，可滚动浏览")}>
        <svg width={layout.width * zoom / 100} height={layout.height * zoom / 100} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label={text("AI supply chain companies", "AI 产业链公司")}>
          <defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#71cfc4"/></marker></defs>
          {layout.groups.map(g => <g key={g.node.id}><rect x={g.x} y={g.y} width={354} height={g.height} rx={20} fill="#10202c" stroke="#263c4c"/><text x={g.x + 18} y={g.y + 32} fill="#c7dae8" fontSize={15}>{label(g.node.id)}</text></g>)}
          {activeEdges.map(e => {
            const a = layout.positions.get(e.source), b = layout.positions.get(e.target); if (!a || !b) return null;
            const role = e.type === "PARTICIPATES_IN", x1 = a.x + 76, y1 = a.y + 24, x2 = b.x + (role ? 0 : 76), y2 = b.y + (role ? 0 : 24);
            return <path key={e.id} d={`M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`} fill="none" stroke={role ? "#8da2ba" : "#71cfc4"} strokeWidth={company ? 2 : 1.4} strokeDasharray={role ? "5 5" : undefined} opacity={company ? .85 : .25} markerEnd={role ? undefined : "url(#graph-arrow)"}/>;
          })}
          {visible.nodes.filter(n => n.kind === "COMPANY").map(n => { const p = layout.positions.get(n.id); if (!p) return null; return <foreignObject key={n.id} x={p.x} y={p.y} width={152} height={50} opacity={company && n.id !== company.id && !connected.has(n.id) ? .35 : 1}><button className={`${styles.node} ${n.market === "US" ? styles.usNode : styles.chinaNode}`} aria-pressed={company?.id === n.id} onClick={() => setSelected(n.id)}><strong>{n.name}</strong><span>{n.symbol} · {n.market === "US" ? text("US", "美股") : text("A-share", "A 股")}</span></button></foreignObject>; })}
        </svg>
      </div>
      <aside className={styles.detail} aria-label={text("Company details", "公司详情")}>
        {company ? <><button className={styles.clear} onClick={() => setSelected("")}>{text("Clear selection", "取消选择")} ×</button><p className={styles.eyebrow}>{company.symbol}</p><h2>{company.name}</h2><p>{company.summary}</p><div className={styles.sources}>{sourceLinks(company.sourceIds ?? [])}</div><h3>{text("Connections & roles", "关系与产业归属")}</h3>{relations.map(e => <article key={e.id}><span>{text(...(relationLabels[e.type] ?? [e.type, e.type]) as [string, string])}{e.commercialStatus === "ANNOUNCED" ? text(" · Announced", " · 已宣布") : ""}</span><strong>{label(e.source)} → {label(e.target)}</strong><p>{e.summary}</p><div className={styles.sources}>{sourceLinks(e.sourceIds)}</div></article>)}</> : <><p className={styles.eyebrow}>{text("EXPLORE THE CONNECTIONS", "探索公司联系")}</p><h2>{text("One industry. Two markets.", "一个产业，两个市场。")}</h2><p>{text("Select a company to highlight its connections and read the original sources. Scroll across the canvas or zoom to explore.", "选择公司，高亮关联并查看原始来源。滚动或缩放画布，探索整个产业。")}</p><p>{text("Companies share industry groups across markets. Group membership does not imply a commercial relationship. Relationship coverage is still growing.", "两个市场的公司按产业环节共同分组。产业归属不代表商业合作，已收录的公司关系仍在扩充。")}</p></>}
      </aside>
    </div>}
  </main>;
}
