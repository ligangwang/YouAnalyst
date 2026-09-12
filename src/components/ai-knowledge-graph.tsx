"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { filterGraph, type KnowledgeGraph, type Market } from "@/lib/knowledge-graph/model";
import { CompanyConstellation } from "./company-constellation";
import { companyPageUrl } from "@/lib/market-companies/routes";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "@/lib/knowledge-graph/sectors";
import styles from "./ai-knowledge-graph.module.css";

const EMPTY: KnowledgeGraph = { nodes: [], relationships: [], sources: [], asOf: "" };
const relationLabels: Record<string, [string, string]> = {
  COMPETES_WITH: ["Competitor", "竞争对手"], CUSTOMER_OF: ["Customer", "客户"], PARTICIPATES_IN: ["Industry role", "产业归属"], SUPPLIER_OF: ["Supplies", "供应"], PARTNER_OF: ["Partner", "合作伙伴"], ECOSYSTEM_PARTNER_OF: ["Ecosystem partner", "生态伙伴"], INTEGRATES_TECHNOLOGY_FROM: ["Integrates technology from", "集成其技术"], PLANNED_ADOPTER_OF: ["Planned adoption", "计划采用"], ENERGY_AGREEMENT_WITH: ["Energy agreement", "能源协议"],
};
export function AiKnowledgeGraph({ initialMarket = "ALL", initialCompany = "" }: { initialMarket?: "ALL" | "NONE" | Market; initialCompany?: string }) {
  const { text } = useLocale();
  const [graph, setGraph] = useState(EMPTY);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [markets, setMarkets] = useState<Market[]>(initialMarket === "ALL" ? ["US", "CN_A"] : initialMarket === "NONE" ? [] : [initialMarket]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initialCompany ? (initialCompany.includes(":") ? initialCompany.toUpperCase() : `US:${initialCompany.toUpperCase()}`) : "");
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const rotate = (degrees: number) => setRotation(angle => (angle + degrees + 360) % 360);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { setGraph(data); setStatus("ready"); }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [retry]);
  const visible = useMemo(() => filterGraph(graph, markets, query), [graph, markets, query]);
  const sectorIds = new Set(visible.nodes.filter(n => n.kind === "COMPANY").map(n => companySector(n).id));
  const [reset, setReset] = useState(0);
  const company = visible.nodes.find(n => n.id === selected && n.kind === "COMPANY");
  const relations = company ? graph.relationships.filter(e => e.source === company.id || e.target === company.id) : [];
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
    <header className={styles.header}><div><p className={styles.eyebrow}>{text("EXPLORE", "探索")}</p><h1>{text("Company graph", "公司图谱")}</h1><p>{text("Discover companies. Follow their connections.", "发现公司，探索彼此的联系。")}</p></div><span className={styles.date}>{graph.asOf}</span></header>
    <div className={styles.controls}>
      <div className={styles.markets} aria-label={text("Markets", "市场")}><button aria-pressed={markets.includes("US")} onClick={() => toggle("US")}>{text("US stocks", "美股")}</button><button aria-pressed={markets.includes("CN_A")} onClick={() => toggle("CN_A")}>{text("A-shares", "A 股")}</button></div>
      <input aria-label={text("Search companies", "搜索公司")} placeholder={text("Search company or ticker…", "搜索公司或股票代码…")} value={query} onChange={e => setQuery(e.target.value)}/>
      <a className={styles.filingLink} href="/map?view=filings">{text("Filing explorer", "财报关系探索")}</a><div className={styles.zoom}><button aria-label={text("Zoom out", "缩小")} disabled={zoom <= 60} onClick={() => setZoom(z => Math.max(60, z - 20))}>−</button><output>{zoom}%</output><button aria-label={text("Zoom in", "放大")} disabled={zoom >= 320} onClick={() => setZoom(z => Math.min(320, z + 20))}>+</button><button aria-label={text("Rotate left", "向左旋转")} onClick={() => rotate(-15)}>↶</button><output aria-label={text("Rotation", "旋转角度")}>{rotation}°</output><button aria-label={text("Rotate right", "向右旋转")} onClick={() => rotate(15)}>↷</button><button onClick={() => { setZoom(100); setRotation(0); setReset(n => n + 1); }}>{text("Fit", "全图")}</button></div>
    </div>
    <div className={styles.legend}><span role="status">{visible.nodes.filter(n => n.kind === "COMPANY").length} {text("companies", "家公司")} · {visible.relationships.filter(e => e.type !== "PARTICIPATES_IN").length} {text("documented connections", "项已收录关系")}</span><span>{text("Solid: recorded relationship · Dashed: announced", "实线：已收录关系 · 虚线：已宣布事项")}</span></div>
    {status === "ready" && sectorIds.size > 0 && <div className={styles.sectorLegend} role="group" aria-label={text("Colors by primary AI sector", "按主要 AI 产业环节着色")}><span>{text("Sector", "产业环节")}</span>{[...GRAPH_SECTORS, OTHER_SECTOR].filter(s => sectorIds.has(s.id)).map(s => <span key={s.id}><i aria-hidden="true" style={{ background: s.color }}/>{text(s.en, s.zh)}</span>)}</div>}
    {status === "loading" ? <p className={styles.empty} role="status">{text("Loading the knowledge graph…", "正在加载知识图谱…")}</p> : status === "error" ? <div className={styles.empty} role="alert">{text("The graph could not be loaded.", "暂时无法加载图谱。")} <button onClick={() => { setStatus("loading"); setRetry(n => n + 1); }}>{text("Try again", "重试")}</button></div> : !visible.nodes.length ? <p className={styles.empty}>{!markets.length ? text("Turn on a market to explore its companies.", "开启一个市场以查看公司。") : text("No matching companies.", "没有匹配的公司。")}</p> : <div className={`${styles.workspace} ${company ? styles.withDetail : ""}`}>
      <CompanyConstellation key={`${markets.join(",")}:${query}:${reset}`} graph={visible} selected={company?.id ?? ""} onSelect={setSelected} zoom={zoom} rotation={rotation} onRotate={rotate} />
      {company && <aside className={styles.detail} aria-label={text("Company details", "公司详情")}>
        <><button className={styles.clear} onClick={() => setSelected("")}>{text("Clear selection", "取消选择")} ×</button><p className={styles.eyebrow}>{company.symbol}</p><h2>{company.name}</h2><a className={styles.profileLink} href={companyPageUrl(company.id.startsWith("US:") ? company.symbol ?? company.id.slice(3) : company.id, company.market)}>{text("Company profile", "公司详情")} →</a><p className={styles.sectorBadge}><i aria-hidden="true" style={{ background: companySector(company).color }}/>{text(companySector(company).en, companySector(company).zh)}</p><p>{company.summary}</p><div className={styles.sources}>{sourceLinks(company.sourceIds ?? [])}</div><h3>{text("Connections & roles", "关系与产业归属")}</h3>{relations.map(e => <article key={e.id}><span>{text(...(relationLabels[e.type] ?? [e.type, e.type]) as [string, string])}{e.commercialStatus === "ANNOUNCED" ? text(" · Announced", " · 已宣布") : ""}</span><strong>{label(e.source)} → {label(e.target)}</strong><p>{e.summary}</p><div className={styles.sources}>{sourceLinks(e.sourceIds)}</div></article>)}</>
      </aside>}
    </div>}
  </main>;
}

