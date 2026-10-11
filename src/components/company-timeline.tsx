"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clusterTimelineEvents, companyTimelineEvents, DEFAULT_TIMELINE_RANGE, timelineWindow, type TimelineEvent, type TimelinePrices } from "@/lib/company-timeline";
import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import type { GraphNode, KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";
import { CompanySnapshot } from "./company-snapshot";
import styles from "./company-timeline.module.css";

export function CompanyTimeline({ companyId, graph, initialPrices, events: suppliedEvents, onSelectEvent }: { companyId: string; graph?: KnowledgeGraph; initialPrices?: TimelinePrices; events?: TimelineEvent[]; onSelectEvent?: (id: string) => void }) {
  const { text, chinese, locale } = useLocale();
  const days = DEFAULT_TIMELINE_RANGE;
  const [closed, setClosed] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; data: TimelinePrices } | null>(null);
  const [loadedGraph, setLoadedGraph] = useState<KnowledgeGraph | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [width, setWidth] = useState(600);
  const chart = useRef<HTMLDivElement>(null);
  const key = `${companyId}:${days}:${retry}`;
  useEffect(() => {
    if (initialPrices?.companyId === companyId) return;
    const controller = new AbortController();
    fetch(`/api/company-timeline?company=${encodeURIComponent(companyId)}&days=${days}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!data || data.companyId !== companyId || !Array.isArray(data.prices)) throw new Error(); return data as TimelinePrices; })
      .then(data => setLoaded({ key, data }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, data: { companyId, ...timelineWindow(days), currency: null, prices: [], available: false } }); });
    return () => controller.abort();
  }, [companyId, days, initialPrices, key]);
  useEffect(() => {
    if (graph) return;
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setLoadedGraph).catch(() => {});
    return () => controller.abort();
  }, [graph]);
  useEffect(() => {
    const el = chart.current; if (!el) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(entry.contentRect.width); });
    observer.observe(el); return () => observer.disconnect();
  }, [closed]);
  const data = initialPrices?.companyId === companyId ? initialPrices : loaded?.key === key ? loaded.data : null;
  const { start, end } = timelineWindow(days, data?.end);
  const events = useMemo(() => suppliedEvents ?? companyTimelineEvents(companyId, graph ?? loadedGraph, curatedEvents, chinese), [suppliedEvents, companyId, graph, loadedGraph, chinese]);
  const left = width < 440 ? 60 : 72, right = Math.max(left + 1, width - 24), plotWidth = right - left;
  const x = (date: string) => left + (Date.parse(date) - Date.parse(start)) / Math.max(1, Date.parse(end) - Date.parse(start)) * plotWidth;
  const prices = data?.prices.filter(p => p.date >= start && p.date <= end) ?? [];
  const groups = clusterTimelineEvents(events, start, end, plotWidth, width < 440 ? 48 : 36, false);
  const selected = events.find(e => e.id === selectedId && e.date >= start && e.date <= end);
  const activeDate = hoverDate && hoverDate >= start && hoverDate <= end ? hoverDate : selected?.date;
  const selectedGroup = groups.find(g => g.events.some(e => e.id === selectedId));
  const min = prices.length ? Math.min(...prices.map(p => p.close)) : 0, max = prices.length ? Math.max(...prices.map(p => p.close)) : 1;
  const pad = Math.max((max - min) * .1, max * .01), low = Math.max(0, min - pad), high = max + pad;
  const y = (value: number) => 102 - (value - low) / Math.max(.001, high - low) * 70;
  const maxVolume = Math.max(1, ...prices.map(p => p.volume ?? 0));
  const pricePath = prices.map((p, index) => { const command = index === 0 || Date.parse(p.date) - Date.parse(prices[index - 1].date) > 7 * 86_400_000 ? "M" : "L"; return `${command}${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`; }).join(" ");
  const nearest = activeDate ? prices.reduce<(typeof prices)[number] | null>((best, p) => !best || Math.abs(Date.parse(p.date) - Date.parse(activeDate)) < Math.abs(Date.parse(best.date) - Date.parse(activeDate)) ? p : best, null) : null;
  const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const categoryLabel = (event: TimelineEvent) => event.category === "filing" ? text("Filing", "公告") : event.lane === "business" ? text("Business", "业务") : text("Research", "研究");
  const markerY = (date: string) => {
    const before = prices.findLast(p => p.date <= date), after = prices.find(p => p.date >= date);
    if (before && after && Date.parse(after.date) - Date.parse(before.date) <= 7 * 86_400_000) {
      const ratio = (Date.parse(date) - Date.parse(before.date)) / Math.max(1, Date.parse(after.date) - Date.parse(before.date));
      return y(before.close + ratio * (after.close - before.close));
    }
    // Keep events visible without inventing a price outside recorded coverage.
    return 16;
  };
  const selectEvent = (id: string) => { setSelectedId(id); setHoverDate(null); onSelectEvent?.(id); };
  const pointerDate = (clientX: number) => {
    const rect = chart.current?.getBoundingClientRect(); if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / plotWidth));
    setHoverDate(new Date(Date.parse(start) + ratio * (Date.parse(end) - Date.parse(start))).toISOString().slice(0, 10));
  };
  if (closed) return <section className={styles.timeline} data-company-timeline={companyId}><button className={styles.retry} type="button" onClick={() => setClosed(false)}>{text("Show timeline", "显示时间轴")}</button></section>;
  return <section className={styles.timeline} aria-label={text("Company event and price timeline", "公司事件与股价时间轴")} data-company-timeline={companyId}>
    <header className={styles.header}><h2>{text("Events, price & volume", "事件、股价与成交量")}</h2><div className={styles.ranges} role="group" aria-label={text("Timeline range", "时间范围")}><span>1M</span><button type="button" aria-label={text("Close timeline", "关闭时间轴")} onClick={() => setClosed(true)}>×</button></div></header>
    <div className={styles.legend}><span data-category="business">● {text("Business", "业务")}</span><span data-category="filing">◆ {text("Filing", "公告")}</span><span data-category="research">■ {text("Research", "研究")}</span></div>
    <div ref={chart} className={styles.chart} onPointerMove={e => { if (!(e.target as Element).closest("button")) pointerDate(e.clientX); }} onPointerLeave={() => setHoverDate(null)} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <svg viewBox={`0 0 ${width} 160`} role="img" aria-label={text("Event categories overlaid on daily close, with volume below", "事件分类叠加在每日收盘价上，下方显示成交量")}>
        <title>{text("Company timeline", "公司时间轴")}</title>
        <text x={0} y={16}>{text("Close", "收盘价")} {data?.currency === "USD" ? "($)" : data?.currency ?? ""}</text>
        {prices.length > 0 ? <>
          {[low, (low + high) / 2, high].map(value => <g key={value}><text x={left - 7} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(locale, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value)}</text><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#263c4e" /></g>)}
          <path d={pricePath} fill="none" stroke="#79cfe9" strokeWidth={2} />
          {prices.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.close)} r={prices.length < 3 ? 3 : 1} fill="#79cfe9" />)}
        </> : <text x={left + 8} y={65}>{!data ? text("Loading stored prices…", "正在读取历史股价…") : !data.available ? text("Stored prices unavailable", "历史股价暂时无法读取") : companyId.startsWith("ORG:") ? text("No supported price history", "暂无支持的股价记录") : text("No stored prices in this range", "此范围暂无已存储股价")}</text>}
        <text x={0} y={125}>{text("Volume", "成交量")}</text>
        {prices.filter(p => p.volume !== null).map(p => <rect key={p.date} x={x(p.date) - 1} y={136 - p.volume! / maxVolume * 22} width={Math.max(1, Math.min(4, plotWidth / Math.max(1, prices.length) * .65))} height={p.volume! / maxVolume * 22} fill="#65879b" />)}
        {prices.length > 0 && prices.every(p => p.volume === null) && <text x={left + 8} y={130}>{text("Volume not recorded", "未记录成交量")}</text>}
        <line x1={left} x2={right} y1={138} y2={138} stroke="#30485a" />
        {Array.from({ length: width < 440 ? 3 : 5 }, (_, i) => i).map((i, _, values) => { const date = new Date(Date.parse(start) + i / (values.length - 1) * (Date.parse(end) - Date.parse(start))).toISOString().slice(0, 10); return <text key={i} x={x(date)} y={155} textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}>{formatDate(date)}</text>; })}
        {activeDate && <line x1={x(activeDate)} x2={x(activeDate)} y1={8} y2={138} stroke="#c4e8f4" opacity={.55} />}
      </svg>
      {groups.map(group => <button key={group.events[0].id} className={styles.marker} data-category={group.events[0].category ?? group.lane} type="button" style={{ left: left + group.x, top: markerY(group.events[0].date) }} title={group.events.map(e => `${categoryLabel(e)} · ${formatDate(e.date)}: ${e.title}`).join("; ")} aria-label={group.events.map(e => `${formatDate(e.date)}: ${e.title}`).join("; ")} aria-pressed={group.events.some(e => e.id === selectedId)} onClick={() => { selectEvent(group.events[0].id); }} onPointerEnter={() => setHoverDate(group.events[0].date)} onFocus={() => setHoverDate(group.events[0].date)} onBlur={() => setHoverDate(null)}>{group.events.length > 1 ? `+${group.events.length}` : group.events[0].category === "filing" ? "◆" : group.lane === "business" ? "●" : "■"}</button>)}
    </div>
    <p className={styles.coverage}>{activeDate && nearest ? `${formatDate(activeDate)} · ${text("Nearest stored close", "最近的已存储收盘价")} ${nearest.close.toFixed(2)} (${formatDate(nearest.date)}) · ${text("Volume", "成交量")} ${nearest.volume === null ? "—" : new Intl.NumberFormat(locale, { notation: "compact" }).format(nearest.volume)}` : prices.length ? `${prices.length} ${text("stored daily bars", "条已存储日线")} · ${formatDate(prices[0].date)} – ${formatDate(prices.at(-1)!.date)} · ${text("Close may be provider-adjusted", "收盘价可能为供应商复权价")}` : text("Events use source publication dates; missing prices are not filled.", "事件以资料发布日期排列；缺失股价不会填补。")}</p>
    {data && !data.available && <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}>{text("Retry prices", "重试读取股价")}</button>}
    {selected && <details className={styles.detail} key={selected.id} open><summary>{formatDate(selected.date)} · {selected.title}</summary>
      {selectedGroup && selectedGroup.events.length > 1 && <div className={styles.eventList}>{selectedGroup.events.map(event => <button key={event.id} type="button" aria-pressed={event.id === selected.id} onClick={() => { selectEvent(event.id); }}>{formatDate(event.date)} · {event.title}</button>)}</div>}
      <p>{selected.description}</p>{selected.planned && <p>{text("Announced / planned; completion is not established.", "已宣布／计划中；尚不代表已完成。")}</p>}<a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{selected.sourceTitle} ↗</a>
    </details>}
  </section>;
}

export function CompanyResearchTimeline({ company, graph, initialPrices }: { company: GraphNode; graph?: KnowledgeGraph; initialPrices?: TimelinePrices }) {
  return <div className={styles.pageResearch}><CompanySnapshot company={company} profileLink={false} /><CompanyTimeline companyId={company.id} graph={graph} initialPrices={initialPrices} /></div>;
}
