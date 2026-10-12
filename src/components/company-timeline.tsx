"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { layoutOverlayMarkers, companyTimelineEvents, DEFAULT_TIMELINE_RANGE, timelineWindow, type TimelineEvent, type TimelinePrices } from "@/lib/ui/company-timeline";
import {EVENT_TYPES,eventPresentation} from '@/lib/events/classification';
import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import type { GraphNode, KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";
import { CompanySnapshot } from "./company-snapshot";
import styles from "./company-timeline.module.css";
import {signedPercent,type EventPriceReturn} from '@/lib/intelligence/price-performance';

export function CompanyTimeline({ companyId, graph, initialPrices, events: suppliedEvents, onSelectEvent,selectedEventId,eventReturns }: { companyId: string; graph?: KnowledgeGraph; initialPrices?: TimelinePrices; events?: TimelineEvent[]; onSelectEvent?: (id: string) => void; selectedEventId?:string;eventReturns?:Record<string,EventPriceReturn[]> }) {
  const { text, chinese, locale } = useLocale();
  const days = DEFAULT_TIMELINE_RANGE;
  const [closed, setClosed] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; data: TimelinePrices } | null>(null);
  const [loadedGraph, setLoadedGraph] = useState<KnowledgeGraph | null>(null);
  const [retry, setRetry] = useState(0);
  const [localSelectedId, setSelectedId] = useState("");
  const selectedId=selectedEventId??localSelectedId;
  const [clusterId,setClusterId]=useState('');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [hoverPrice, setHoverPrice] = useState(false);
  const [width, setWidth] = useState(600);
  const chart = useRef<HTMLDivElement>(null);
  const eventChooser = useRef<HTMLDivElement>(null);
  const chooserTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (clusterId) eventChooser.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [clusterId]);
  const closeChooser = () => {setClusterId('');(chooserTrigger.current?.isConnected?chooserTrigger.current:chart.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]'))?.focus();};
  const toggleButton = useRef<HTMLButtonElement>(null);
  const restoreToggleFocus = useRef(false);
  useEffect(() => {
    if (restoreToggleFocus.current) { toggleButton.current?.focus(); restoreToggleFocus.current = false; }
  }, [closed]);
  const toggleTimeline = (value: boolean) => { restoreToggleFocus.current = true; setClosed(value); };
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
  const small=width<440,priceTop=24,priceBottom=small?164:140,volumeBottom=priceBottom+32,chartHeight=volumeBottom+24;
  const selected = events.find(e => e.id === selectedId && e.date >= start && e.date <= end);
  const activeDate = hoverDate && hoverDate >= start && hoverDate <= end ? hoverDate : selected?.date;
  const min = prices.length ? Math.min(...prices.map(p => p.close)) : 0, max = prices.length ? Math.max(...prices.map(p => p.close)) : 1;
  const pad = Math.max((max - min) * .1, max * .01), low = Math.max(0, min - pad), high = max + pad;
  const y = (value: number) => priceBottom - (value - low) / Math.max(.001, high - low) * (priceBottom-priceTop);
  const groups=layoutOverlayMarkers(events,start,end,plotWidth,priceTop,priceBottom,prices.map(price=>({x:x(price.date)-left,y:y(price.close)})),small?34:26);
  const openCluster=groups.find(group=>group.events.some(event=>event.id===clusterId));
  const selectedGroup=groups.find(group=>group.events.some(event=>event.id===selectedId));
  const maxVolume = Math.max(1, ...prices.map(p => p.volume ?? 0));
  const pricePath = prices.map((p, index) => { const command = index === 0 || Date.parse(p.date) - Date.parse(prices[index - 1].date) > 7 * 86_400_000 ? "M" : "L"; return `${command}${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`; }).join(" ");
  // Bridge long intervals without implying that daily bars were recorded inside them.
  const gapPath = prices.flatMap((p,index)=>index>0&&Date.parse(p.date)-Date.parse(prices[index-1].date)>7*86_400_000
    ? [`M${x(prices[index-1].date).toFixed(2)},${y(prices[index-1].close).toFixed(2)} L${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`]:[]).join(" ");
  const nearest = activeDate ? prices.reduce<(typeof prices)[number] | null>((best, p) => !best || Math.abs(Date.parse(p.date) - Date.parse(activeDate)) < Math.abs(Date.parse(best.date) - Date.parse(activeDate)) ? p : best, null) : null;
  const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const selectEvent = (id: string) => { setSelectedId(id);if(clusterId)closeChooser(); setHoverDate(null); onSelectEvent?.(id); };
  const pointerDate = (clientX: number) => {
    const rect = chart.current?.getBoundingClientRect(); if (!rect) return;
    setHoverPrice(true);
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / plotWidth));
    const dayOffset=Math.round(ratio*(Date.parse(end)-Date.parse(start))/86_400_000);
    setHoverDate(new Date(Date.parse(start)+dayOffset*86_400_000).toISOString().slice(0, 10));
  };
  const returnFor=(id:string)=>eventReturns?.[id]?.find(value=>value.companyId===companyId);
  const dailyReturnFor=(date:string)=>{
    const index=prices.findIndex(price=>price.date===date);
    if(index<1)return;
    const current=prices[index],previous=prices[index-1];
    const gap=(Date.parse(current.date)-Date.parse(previous.date))/86_400_000;
    // A weekday gap may be a holiday or missing history; do not infer a daily return.
    const adjacent=gap===1||(gap===3&&new Date(previous.date).getUTCDay()===5&&new Date(current.date).getUTCDay()===1);
    return {baselineDate:previous.date,latestDate:current.date,change:current.close/previous.close-1,adjacent};
  };
  const hoverReturn=nearest?dailyReturnFor(nearest.date):undefined;
  const latest=prices.at(-1);
  const toLatest=nearest&&latest&&nearest.close>0?latest.close/nearest.close-1:undefined;
  const tooltipHalfWidth=Math.min(140,Math.max(0,width/2-8));
  const returnLabel=(value:EventPriceReturn)=>{
    const days=Math.round((Date.parse(value.latestDate)-Date.parse(value.baselineDate))/86_400_000);
    const label=`${text('Since pub.','发布以来')} (${days}${text('d','天')}):`;
    const hint=`${label} ${signedPercent(value.change)} · ${value.baselineDate} → ${value.latestDate} · ${text('Last completed close before publication; excludes dividend and split adjustments.','使用发布前最后一个完整交易日的收盘价；不含股息与拆股调整。')}`;
    return <span className={styles.chooserReturn} data-return-direction={value.change>0?'up':value.change<0?'down':'flat'} title={hint} aria-label={hint}>{`${label} `}{value.change>0?'▲':value.change<0?'▼':'—'} {signedPercent(value.change)}</span>;
  };
  if (closed) return <section className={styles.timeline} data-company-timeline={companyId}><button ref={toggleButton} className={styles.retry} type="button" onClick={() => toggleTimeline(false)}>{text("Show timeline", "显示时间轴")}</button></section>;
  return <section className={styles.timeline} aria-label={text("Company event and price timeline", "公司事件与股价时间轴")} data-company-timeline={companyId}>
    <header className={styles.header}><h2>{text("Events, price & volume", "事件、股价与成交量")}</h2><div className={styles.ranges} role="group" aria-label={text("Timeline range", "时间范围")}><span>1M</span><button ref={toggleButton} type="button" aria-label={text("Close timeline", "关闭时间轴")} onClick={() => toggleTimeline(true)}>×</button></div></header>
    <div className={styles.legend}>{EVENT_TYPES.map(eventType=>{const style=eventPresentation({eventType},chinese);return <span key={eventType} style={{color:style.color}}>{style.symbol} {style.typeLabel}</span>;})}</div>
    <div ref={chart} className={styles.chart} style={{height:chartHeight}} onKeyDown={e=>{if(e.key==='Escape'&&clusterId){e.stopPropagation();closeChooser();}}} onPointerMove={e => { if (!(e.target as Element).closest("button")) pointerDate(e.clientX); else setHoverPrice(false); }} onPointerLeave={() => {setHoverDate(null);setHoverPrice(false);}} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <svg data-event-layout="overlay" data-price-top={priceTop} data-price-bottom={priceBottom} style={{height:chartHeight}} viewBox={`0 0 ${width} ${chartHeight}`} role="img" aria-label={text("Dated event markers over daily close, with volume below", "事件按发布日期叠加在收盘价图中，下方为成交量")}>
        <text x={0} y={priceTop-8}>{text("Close", "收盘价")} {data?.currency === "USD" ? "($)" : data?.currency ?? ""}</text>
        {prices.length > 0 ? <>
          {[low, (low + high) / 2, high].map(value => <g key={value}><text x={left - 7} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(locale, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value)}</text><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#263c4e" /></g>)}
          <path data-price-line d={pricePath} fill="none" stroke="#79cfe9" strokeWidth={2} />
          {gapPath&&<path data-price-gap d={gapPath} fill="none" stroke="#79cfe9" strokeWidth={2} strokeDasharray="4 4" />}
          {prices.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.close)} r={prices.length < 3 ? 3 : 1} fill="#79cfe9" />)}
        </> : <text x={left + 8} y={volumeBottom-8}>{!data ? text("Loading stored prices…", "正在读取历史股价…") : !data.available ? text("Stored prices unavailable", "历史股价暂时无法读取") : companyId.startsWith("ORG:") ? text("No supported price history", "暂无支持的股价记录") : text("No stored prices in this range", "此范围暂无已存储股价")}</text>}
        <text x={0} y={volumeBottom-12}>{text("Volume", "成交量")}</text>
        {prices.filter(p => p.volume !== null).map(p => <rect key={p.date} x={x(p.date) - 1} y={volumeBottom - p.volume! / maxVolume * 22} width={Math.max(1, Math.min(4, plotWidth / Math.max(1, prices.length) * .65))} height={p.volume! / maxVolume * 22} fill="#65879b" />)}
        {prices.length > 0 && prices.every(p => p.volume === null) && <text x={left + 8} y={volumeBottom-6}>{text("Volume not recorded", "未记录成交量")}</text>}
        <line x1={left} x2={right} y1={volumeBottom+2} y2={volumeBottom+2} stroke="#30485a" />
        {Array.from({ length: width < 440 ? 3 : 5 }, (_, i) => i).map((i, _, values) => { const date = new Date(Date.parse(start) + i / (values.length - 1) * (Date.parse(end) - Date.parse(start))).toISOString().slice(0, 10); return <text key={i} x={x(date)} y={chartHeight-6} textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}>{formatDate(date)}</text>; })}
        {activeDate && <line x1={hoverPrice && nearest ? x(nearest.date) : x(activeDate)} x2={hoverPrice && nearest ? x(nearest.date) : x(activeDate)} y1={8} y2={volumeBottom+2} stroke="#c4e8f4" opacity={.55} />}
        {hoverPrice && hoverDate && nearest && <circle cx={x(nearest.date)} cy={y(nearest.close)} r={4} fill="#79cfe9" stroke="#e5f7ff" strokeWidth={2} />}
      </svg>
      {hoverPrice && hoverDate && nearest && <div className={styles.priceTooltip} role="tooltip" style={{left:Math.max(tooltipHalfWidth+8,Math.min(width-tooltipHalfWidth-8,x(nearest.date))),top:y(nearest.close)-12}}>
        <span>{nearest.date}</span>
        <strong>{text("Close", "收盘价")} · {new Intl.NumberFormat(locale, data?.currency ? {style:"currency",currency:data.currency,minimumFractionDigits:2,maximumFractionDigits:2} : {minimumFractionDigits:2,maximumFractionDigits:2}).format(nearest.close)}</strong>
        {hoverReturn&&<span title={`${hoverReturn.baselineDate} → ${hoverReturn.latestDate}`}>{hoverReturn.adjacent?text('Daily change','当日涨跌幅'):`${text('Change since','较')} ${hoverReturn.baselineDate}`} · <b data-daily-return data-return-direction={hoverReturn.change>0?'up':hoverReturn.change<0?'down':'flat'}>{hoverReturn.change>0?'▲':hoverReturn.change<0?'▼':'—'} {signedPercent(hoverReturn.change)}</b></span>}
        {toLatest!==undefined&&latest&&<span title={`${nearest.date} → ${latest.date}`} data-latest-return>{text('Change to latest close','至最新收盘涨跌幅')} ({formatDate(latest.date)}) · <b data-return-direction={toLatest>0?'up':toLatest<0?'down':'flat'}>{toLatest>0?'▲':toLatest<0?'▼':'—'} {signedPercent(toLatest)}</b></span>}
        <span>{text("Volume", "成交量")} · {nearest.volume === null ? text("Not recorded", "未记录") : new Intl.NumberFormat(locale).format(nearest.volume)}</span>
      </div>}
      {groups.map(group=>{const presentations=[...new Map(group.events.map(event=>{const p=eventPresentation(event,chinese);return [p.symbol+p.color,p] as const;})).values()],style=presentations[0],multiple=group.events.length>1;return <button key={group.events[0].id} className={styles.marker} data-event-type={presentations.length>1?'multiple':style.type} data-marker-size={group.size} data-event-count={group.events.length} type="button" style={{left:left+group.x,top:group.y,width:group.size,height:group.size,color:style.color,borderColor:style.color}} title={group.events.map(e=>`${eventPresentation(e,chinese).label} · ${formatDate(e.date)}: ${e.title}`).join('; ')} aria-label={multiple?`${group.events.length} ${text('events','个事件')} · ${presentations.map(p=>p.label).join(' / ')} · ${formatDate(group.events[0].date)}`:`${formatDate(group.events[0].date)}: ${group.events[0].title}`} aria-pressed={group.events.some(e=>e.id===clusterId||e.id===selectedId)} onClick={e=>{if(multiple){chooserTrigger.current=e.currentTarget;setClusterId(group.events[0].id);}else selectEvent(group.events[0].id);}} onPointerEnter={()=>{setHoverPrice(false);setHoverDate(group.events[0].date);}} onFocus={()=>{setHoverPrice(false);setHoverDate(group.events[0].date);}} onBlur={()=>{setHoverDate(null);}}><span className={styles.markerSymbols} data-mixed={presentations.length>1||undefined}>{presentations.slice(0,3).map(p=><span key={p.symbol+p.color} style={{color:p.color}}>{p.symbol}</span>)}</span>{multiple&&<span className={styles.countBadge} aria-hidden="true">{group.events.length}</span>}</button>;})}
      {openCluster&&<div ref={eventChooser} className={`${styles.eventList} ${styles.clusterPopup}`} role="group" aria-label={text('Choose an event','选择事件')} onPointerMove={e=>{e.stopPropagation();setHoverPrice(false);}}>
        <div className={styles.popupHeader}><span>{openCluster.events.length} {text('events','个事件')}</span><button type="button" aria-label={text('Close event list','关闭事件列表')} onClick={closeChooser}>×</button></div>
        {openCluster.events.map(event=>{const style=eventPresentation(event,chinese);return <button key={event.id} type="button" onClick={()=>selectEvent(event.id)}><span style={{color:style.color}}>{style.symbol} {style.label}</span> · {formatDate(event.date)} · {event.title}{returnFor(event.id)&&returnLabel(returnFor(event.id)!)}</button>;})}
      </div>}
    </div>
    <p className={styles.coverage}>{activeDate && nearest ? `${formatDate(activeDate)} · ${text("Nearest stored close", "最近的已存储收盘价")} ${nearest.close.toFixed(2)} (${formatDate(nearest.date)}) · ${text("Volume", "成交量")} ${nearest.volume === null ? "—" : new Intl.NumberFormat(locale, { notation: "compact" }).format(nearest.volume)}` : prices.length ? `${prices.length} ${text("stored daily bars", "条已存储日线")} · ${formatDate(prices[0].date)} – ${formatDate(prices.at(-1)!.date)} · ${text("Close may be provider-adjusted", "收盘价可能为供应商复权价")}` : text("Events use source publication dates; missing prices are not filled.", "事件以资料发布日期排列；缺失股价不会填补。")}</p>
    {data && !data.available && <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}>{text("Retry prices", "重试读取股价")}</button>}
    {selected && !onSelectEvent && <details className={styles.detail} key={selected.id} open><summary>{eventPresentation(selected,chinese).label} · {formatDate(selected.date)} · {selected.title}</summary>
      {selectedGroup && selectedGroup.events.length > 1 && <div className={styles.eventList}>{selectedGroup.events.map(event => <button key={event.id} type="button" aria-pressed={event.id === selected.id} onClick={() => { selectEvent(event.id); }}>{formatDate(event.date)} · {event.title}</button>)}</div>}
      <p>{selected.description}</p>{selected.planned && <p>{text("Announced / planned; completion is not established.", "已宣布／计划中；尚不代表已完成。")}</p>}<a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{selected.sourceTitle} ↗</a>
    </details>}
  </section>;
}

export function CompanyResearchTimeline({ company, graph, initialPrices }: { company: GraphNode; graph?: KnowledgeGraph; initialPrices?: TimelinePrices }) {
  return <div className={styles.pageResearch}><CompanySnapshot company={company} profileLink={false} /><CompanyTimeline companyId={company.id} graph={graph} initialPrices={initialPrices} /></div>;
}
