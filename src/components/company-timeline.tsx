"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { tradingSessionAxis, layoutOverlayMarkers, companyTimelineEvents, DEFAULT_TIMELINE_RANGE, timelineWindow, type TimelineRange, type TimelineEvent, type TimelinePrices } from "@/lib/ui/company-timeline";
import { MA_PERIODS, MA_COLORS, simpleMovingAverage, movingAverageConvergence, type IndicatorPoint } from '@/lib/ui/technical-indicators';
import { ChartSizeControls, useChartSize } from './chart-size-controls';
import { FloatingEventWindow, eventWindowAnchor, type EventWindowAnchor } from './event-details-window';
import {EVENT_TYPES,eventPresentation} from '@/lib/events/classification';
import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import type { GraphNode, KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";
import { CompanySnapshot } from "./company-snapshot";
import styles from "./company-timeline.module.css";
import {signedPercent,type EventPriceReturn} from '@/lib/intelligence/price-performance';

export function CompanyTimeline({ companyId, graph, initialPrices, events: suppliedEvents, onSelectEvent,onDismissEvent,selectedEventId,eventReturns }: { companyId: string; graph?: KnowledgeGraph; initialPrices?: TimelinePrices; events?: TimelineEvent[]; onSelectEvent?: (id: string,anchor?:EventWindowAnchor) => void; onDismissEvent?:()=>void;selectedEventId?:string;eventReturns?:Record<string,EventPriceReturn[]> }) {
  const { text, chinese, locale } = useLocale();
  const categoryColor = (color: string) => `color-mix(in srgb, ${color} var(--event-color-weight,100%), var(--ui-text,${color}))`;
  const chartHelpId = useId();
  const [days,setDays] = useState<TimelineRange>(DEFAULT_TIMELINE_RANGE);
  const {size:chartSize,setSize:setChartSize,root:chartSizeRef,viewportHeight} = useChartSize();
  const [averages,setAverages] = useState<number[]>([]);
  const [showMacd,setShowMacd] = useState(false);
  const [showEvents,setShowEvents] = useState(true);
  const needsHistory = averages.length>0 || showMacd;
  const [chartMode,setChartMode]=useState<"candles"|"line">("candles");
  const [closed, setClosed] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; data: TimelinePrices } | null>(null);
  const [loadedGraph, setLoadedGraph] = useState<KnowledgeGraph | null>(null);
  const [retry, setRetry] = useState(0);
  const [localSelectedId, setSelectedId] = useState("");
  const [eventAnchor,setEventAnchor] = useState<EventWindowAnchor|null>(null);
  const selectedId=selectedEventId??localSelectedId;
  const [clusterId,setClusterId]=useState('');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [priceSelection, setPriceSelection] = useState<{companyId:string;date:string} | null>(null);
  const priceDate = priceSelection?.companyId === companyId ? priceSelection.date : null;
  const [width, setWidth] = useState(600);
  const chart = useRef<HTMLDivElement>(null);
  const [clusterAnchor,setClusterAnchor] = useState<EventWindowAnchor|null>(null);
  const closePriceDetails = (restoreFocus = false) => {
    setPriceSelection(null);
    if (restoreFocus) chart.current?.querySelector<SVGSVGElement>('svg')?.focus();
  };
  useEffect(() => {
    if (!priceDate) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !chart.current?.contains(event.target)) setPriceSelection(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [priceDate]);
  const chooserTrigger = useRef<HTMLButtonElement>(null);
  const closeChooser = () => {setClusterId('');(chooserTrigger.current?.isConnected?chooserTrigger.current:chart.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]'))?.focus({preventScroll:true});};
  const toggleButton = useRef<HTMLButtonElement>(null);
  const restoreToggleFocus = useRef(false);
  useEffect(() => {
    if (restoreToggleFocus.current) { toggleButton.current?.focus(); restoreToggleFocus.current = false; }
  }, [closed]);
  const toggleTimeline = (value: boolean) => { restoreToggleFocus.current = true; setClosed(value); if(value)setChartSize("compact"); setPriceSelection(null); setClusterId(''); setHoverDate(null); };
  const key = `${companyId}:${days}:${needsHistory}:${retry}`;
  const matchingInitial = initialPrices?.companyId===companyId && initialPrices.start<=timelineWindow(days,initialPrices.end).start ? initialPrices : null;
  const initialHistoryReady = Boolean(matchingInitial && (matchingInitial.warmupPrices || matchingInitial.prices.filter(price=>price.date<timelineWindow(days,matchingInitial.end).start).length>=100));
  useEffect(() => {
    if (matchingInitial && (!needsHistory || initialHistoryReady)) return;
    const controller = new AbortController();
    fetch(`/api/company-timeline?company=${encodeURIComponent(companyId)}&days=${days}${needsHistory?'&indicators=1':''}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!data || data.companyId !== companyId || !Array.isArray(data.prices)) throw new Error(); return data as TimelinePrices; })
      .then(data => setLoaded({ key, data }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, data: { companyId, ...timelineWindow(days), currency: null, prices: [], available: false } }); });
    return () => controller.abort();
  }, [companyId, days, matchingInitial, initialHistoryReady, needsHistory, key]);
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
  const data = loaded?.key===key ? loaded.data : matchingInitial ?? (loaded?.data.companyId===companyId && loaded.data.start===timelineWindow(days,loaded.data.end).start ? loaded.data : null);
  const { start, end } = timelineWindow(days, data?.end);
  const events = useMemo(() => suppliedEvents ?? companyTimelineEvents(companyId, graph ?? loadedGraph, curatedEvents, chinese), [suppliedEvents, companyId, graph, loadedGraph, chinese]);
  const left = width < 440 ? 60 : 72, right = Math.max(left + 1, width - 24), plotWidth = right - left;
  const prices = data?.prices.filter(p => p.date >= start && p.date <= end).sort((a,b)=>a.date.localeCompare(b.date)) ?? [];
  const axis = tradingSessionAxis(prices.map(price=>price.date),start,end);
  const x = (date: string) => left + axis.ratio(date) * plotWidth;
  const tickCount = width < 440 ? 3 : 5;
  const tickDates = [...new Set(Array.from({length:tickCount},(_,i)=>axis.dateAt(i/(tickCount-1))))];
  const small=width<440,priceTop=24,priceBottom=chartSize==='compact'?(small?164:140):Math.max(160,Math.floor(viewportHeight*(chartSize==='full'?.65:.4))-56-(showMacd?100:0)),volumeBottom=priceBottom+32,chartHeight=volumeBottom+24+(showMacd?100:0);
  const selected = events.find(e => e.id === selectedId && e.date >= start && e.date <= end);
  const activeDate = priceDate ?? (hoverDate && hoverDate >= start && hoverDate <= end ? hoverDate : selected?.date);
  const candles=prices.filter((price):price is typeof price&{open:number;high:number;low:number}=>price.open!==undefined&&price.high!==undefined&&price.low!==undefined);
  const useCandles=chartMode==='candles'&&candles.length>0;
  const history = [...new Map([...(data?.warmupPrices??[]),...(data?.prices??[])].map(price=>[price.date,price])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  const movingAverages = MA_PERIODS.map(period=>simpleMovingAverage(history,period).filter(point=>point.date>=start&&point.date<=end));
  const macd = movingAverageConvergence(history).filter(point=>point.date>=start&&point.date<=end);
  const averageValues = movingAverages.flatMap((points,index)=>averages.includes(MA_PERIODS[index])?points.map(point=>point.value):[]);
  const min = prices.length ? Math.min(...prices.map(p => useCandles?p.low??p.close:p.close),...averageValues) : 0, max = prices.length ? Math.max(...prices.map(p => useCandles?p.high??p.close:p.close),...averageValues) : 1;
  const candleWidth=Math.max(2,Math.min(10,plotWidth/Math.max(1,prices.length)*.65));
  const pad = Math.max((max - min) * .1, max * .01), low = Math.max(0, min - pad), high = max + pad;
  // Keep a compact escape row above the full wick range, within the existing chart height.
  const headroom=useCandles&&showEvents&&events.some(event=>event.date>=start&&event.date<=end)?Math.min(40,(priceBottom-priceTop)*.3):0;
  const y = (value: number) => priceBottom - (value - low) / Math.max(.001, high - low) * (priceBottom-priceTop-headroom);
  const groups=layoutOverlayMarkers(showEvents?events:[],start,end,plotWidth,priceTop,priceBottom,useCandles?[]:prices.map(price=>({x:x(price.date)-left,y:y(price.close)})),small?34:26,date=>x(date)-left,useCandles?prices.map(price=>({left:x(price.date)-left-candleWidth/2,right:x(price.date)-left+candleWidth/2,top:y(price.high??price.close),bottom:y(price.low??price.close)})):[]);
  const openCluster=groups.find(group=>group.events.some(event=>event.id===clusterId));
  const selectedGroup=groups.find(group=>group.events.some(event=>event.id===selectedId));
  const maxVolume = Math.max(1, ...prices.map(p => p.volume ?? 0));
  const pricePath = prices.map((p, index) => { const command = index === 0 || Date.parse(p.date) - Date.parse(prices[index - 1].date) > 7 * 86_400_000 ? "M" : "L"; return `${command}${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`; }).join(" ");
  // Bridge long intervals without implying that daily bars were recorded inside them.
  const gapPath = prices.flatMap((p,index)=>index>0&&Date.parse(p.date)-Date.parse(prices[index-1].date)>7*86_400_000
    ? [`M${x(prices[index-1].date).toFixed(2)},${y(prices[index-1].close).toFixed(2)} L${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`]:[]).join(" ");
  const nearest = activeDate ? prices.reduce<(typeof prices)[number] | null>((best, p) => !best || Math.abs(Date.parse(p.date) - Date.parse(activeDate)) < Math.abs(Date.parse(best.date) - Date.parse(activeDate)) ? p : best, null) : null;
  const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const selectEvent = (id: string,click?:React.MouseEvent<HTMLButtonElement>) => { const anchor=click?eventWindowAnchor(click):null;if(anchor&&clusterId&&chooserTrigger.current?.isConnected)anchor.trigger=chooserTrigger.current;setEventAnchor(anchor);setPriceSelection(null); setSelectedId(id);if(clusterId)closeChooser(); setHoverDate(null); onSelectEvent?.(id,anchor??undefined); };
  const selectPriceAt = (clientX: number) => {
    const rect = chart.current?.getBoundingClientRect(); if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / plotWidth));
    if (prices.length) { setClusterId(''); setPriceSelection({companyId,date:axis.dateAt(ratio)}); }
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
  const indicatorPath=(points:IndicatorPoint[],valueY:(value:number)=>number)=>points.map((point,index)=>`${index===0?'M':'L'}${x(point.date).toFixed(2)},${valueY(point.value).toFixed(2)}`).join(' ');
  const macdTop=volumeBottom+32,macdBottom=chartHeight-24;
  const macdExtent=Math.max(.001,...macd.flatMap(point=>[Math.abs(point.dif),Math.abs(point.signal),Math.abs(point.histogram)]))*1.1;
  const macdY=(value:number)=>macdTop+(macdBottom-macdTop)/2-value/macdExtent*(macdBottom-macdTop)/2;
  const toLatest=nearest&&latest&&nearest.close>0?latest.close/nearest.close-1:undefined;
  const tooltipHalfWidth=Math.min(140,Math.max(0,width/2-8));
  const returnLabel=(value:EventPriceReturn)=>{
    const days=Math.round((Date.parse(value.latestDate)-Date.parse(value.baselineDate))/86_400_000);
    const label=`${text('Since pub.','发布以来')} (${days}${text('d','天')}):`;
    const hint=`${label} ${signedPercent(value.change)} · ${value.baselineDate} → ${value.latestDate} · ${text('Last completed close before publication; excludes dividend and split adjustments.','使用发布前最后一个完整交易日的收盘价；不含股息与拆股调整。')}`;
    return <span className={styles.chooserReturn} data-return-direction={value.change>0?'up':value.change<0?'down':'flat'} title={hint} aria-label={hint}>{`${label} `}{value.change>0?'▲':value.change<0?'▼':'—'} {signedPercent(value.change)}</span>;
  };
  if (closed) return <section className={styles.timeline} data-company-timeline={companyId}><button ref={toggleButton} className={styles.retry} type="button" onClick={() => toggleTimeline(false)}>{text("Show timeline", "显示时间轴")}</button></section>;
  return <section ref={chartSizeRef} className={styles.timeline} role={chartSize==='full'?'dialog':undefined} aria-modal={chartSize==='full'||undefined} tabIndex={-1} data-chart-size={chartSize} aria-label={text("Company event and price timeline", "公司事件与股价时间轴")} data-company-timeline={companyId}>
    <header className={styles.header}><h2>{text("Events, price & volume", "事件、股价与成交量")}</h2><div className={styles.ranges} role="group" aria-label={text("Timeline range", "时间范围")}><div role="group" aria-label={text('Chart type','图表类型')} className={styles.chartModes}><button type="button" aria-pressed={chartMode==='candles'} onClick={()=>setChartMode('candles')}>{text('Candles','蜡烛图')}</button><button type="button" aria-pressed={chartMode==='line'} onClick={()=>setChartMode('line')}>{text('Line','曲线')}</button></div><span>{({30:"1M",90:"3M",180:"6M",365:"1Y",1826:"5Y"})[days]}</span><button ref={toggleButton} type="button" aria-label={text("Close timeline", "关闭时间轴")} onClick={() => toggleTimeline(true)}>×</button></div></header>
    <div className={styles.tools}>
      <ChartSizeControls size={chartSize} onChange={setChartSize}/>
      <label>{text('Range','范围')} <select aria-label={text('Price history range','股价时间范围')} value={days} onChange={event=>{setDays(Number(event.target.value) as TimelineRange);setPriceSelection(null);setClusterId('');setHoverDate(null);}}>{[30,90,180,365].map((range,index)=><option key={range} value={range}>{['1M','3M','6M','1Y'][index]}</option>)}</select></label>
      <div role="group" aria-label={text('Technical indicators','技术指标')} className={styles.indicatorControls}>
        {MA_PERIODS.map((period,index)=><button type="button" key={period} aria-pressed={averages.includes(period)} style={{color:MA_COLORS[index]}} onClick={()=>setAverages(values=>values.includes(period)?values.filter(value=>value!==period):[...values,period])}>{text('MA','MA')}{period}</button>)}
        <button type="button" aria-pressed={showMacd} title={text('DIF = EMA12 − EMA26; DEA = EMA9(DIF); histogram = DIF − DEA','DIF = EMA12 − EMA26；DEA = DIF 的 EMA9；柱值 = DIF − DEA')} onClick={()=>setShowMacd(value=>!value)}>{text('MACD (12,26,9)','MACD (12,26,9)')}</button>
        <button type="button" aria-pressed={showEvents} onClick={()=>{setShowEvents(value=>!value);setClusterId('');setHoverDate(null);}}>{text('Events','事件')}</button>
      </div>
    </div>
    {needsHistory&&loaded?.key!==key&&!initialHistoryReady&&<p className={styles.status} role="status">{text('Loading indicator history…','正在加载指标历史数据…')}</p>}
    {needsHistory&&loaded?.key===key&&averages.some(period=>!movingAverages[MA_PERIODS.indexOf(period as typeof MA_PERIODS[number])]?.length)&&<p className={styles.status}>{text('Some moving averages have insufficient stored history.','部分均线的已存储历史数据不足。')}</p>}
    {showMacd&&<div className={styles.indicatorLegend}><span style={{color:MA_COLORS[0]}}>{text('DIF','DIF')}</span><span style={{color:MA_COLORS[1]}}>{text('DEA','DEA')}</span><span>{text('Histogram = DIF − DEA','柱值 = DIF − DEA')}</span></div>}
    {showEvents&&<div className={styles.legend}>{EVENT_TYPES.map(eventType=>{const style=eventPresentation({eventType},chinese);return <span key={eventType} style={{color:categoryColor(style.color)}}>{style.symbol} {style.typeLabel}</span>;})}</div>}
    <div ref={chart} className={styles.chart} style={{height:chartHeight}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();if(clusterId)closeChooser();else closePriceDetails(true);}}} onClick={e => { if (!(e.target as Element).closest("button,[data-price-details],[data-event-chooser]")) selectPriceAt(e.clientX); }} onPointerLeave={() => setHoverDate(null)} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <svg tabIndex={0} aria-describedby={chartHelpId} onKeyDown={e=>{
        if (!prices.length || !['Enter',' ','ArrowLeft','ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const current = Math.max(0,prices.findIndex(price=>price.date===(priceDate??prices.at(-1)!.date)));
        const index = Math.max(0,Math.min(prices.length-1,current+(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0)));
        setClusterId(''); setPriceSelection({companyId,date:prices[index].date});
      }} data-time-axis={prices.length?"trading-sessions":"calendar"} data-chart-type={useCandles?"candles":"line"} data-event-layout="overlay" data-price-top={priceTop} data-price-bottom={priceBottom} style={{height:chartHeight}} viewBox={`0 0 ${width} ${chartHeight}`} role="img" aria-label={useCandles?text("Dated event markers over daily candlesticks, with volume below","事件按发布日期叠加在日线蜡烛图中，下方为成交量"):text("Dated event markers over daily close, with volume below", "事件按发布日期叠加在收盘价图中，下方为成交量")}>
        <desc id={chartHelpId}>{text("Click or tap to view price details. Press Enter to open, arrow keys to change session, and Escape to close.","点击查看股价详情。按回车打开，方向键切换交易日，Esc 关闭。")}</desc>
        <text x={0} y={priceTop-8}>{useCandles?text("Price","股价"):text("Close", "收盘价")} {data?.currency === "USD" ? "($)" : data?.currency ?? ""}</text>
        {prices.length > 0 ? <>
          {[low, (low + high) / 2, high].map(value => <g key={value}><text x={left - 7} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(locale, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value)}</text><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--ui-line,#263c4e)" /></g>)}
          {latest&&<g data-latest-close-reference><line x1={left} x2={right} y1={y(latest.close)} y2={y(latest.close)} stroke="var(--chart-reference,#c9b879)" strokeWidth={1} strokeDasharray="2 4"/><text x={right} y={priceTop-8} textAnchor="end" style={{fill:'var(--chart-reference,#c9b879)',fontSize:10}}>{text('Latest close','最新收盘')} {new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(latest.close)}</text></g>}
          {useCandles?candles.map(price=>{const color=price.close>price.open?'var(--price-up,#55dfbb)':price.close<price.open?'var(--price-down,#ff8ea1)':'var(--price-flat,#b8cfe1)';return <g key={price.date} data-price-candle={price.date} data-candle-direction={price.close>price.open?'up':price.close<price.open?'down':'flat'}><line x1={x(price.date)} x2={x(price.date)} y1={y(price.high)} y2={y(price.low)} stroke={color}/><rect x={x(price.date)-candleWidth/2} y={Math.min(y(price.open),y(price.close))} width={candleWidth} height={Math.max(1,Math.abs(y(price.open)-y(price.close)))} fill={color}/></g>}):<path data-price-line d={pricePath} fill="none" stroke="var(--chart-line,#79cfe9)" strokeWidth={2} />}
          {!useCandles&&gapPath&&<path data-price-gap d={gapPath} fill="none" stroke="var(--chart-line,#79cfe9)" strokeWidth={2} strokeDasharray="4 4" />}
          {movingAverages.map((points,index)=>averages.includes(MA_PERIODS[index])&&<path key={MA_PERIODS[index]} data-moving-average={MA_PERIODS[index]} d={indicatorPath(points,y)} fill="none" stroke={MA_COLORS[index]} strokeWidth={1.5} pointerEvents="none"/>)}
          {prices.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.close)} r={useCandles?(p.open===undefined?2:0):prices.length < 3 ? 3 : 1} fill="var(--chart-line,#79cfe9)" />)}
        </> : <text x={left + 8} y={volumeBottom-8}>{!data ? text("Loading stored prices…", "正在读取历史股价…") : !data.available ? text("Stored prices unavailable", "历史股价暂时无法读取") : companyId.startsWith("ORG:") ? text("No supported price history", "暂无支持的股价记录") : text("No stored prices in this range", "此范围暂无已存储股价")}</text>}
        <text x={0} y={volumeBottom-12}>{text("Volume", "成交量")}</text>
        {prices.filter(p => p.volume !== null).map(p => <rect key={p.date} x={x(p.date) - 1} y={volumeBottom - p.volume! / maxVolume * 22} width={Math.max(1, Math.min(4, plotWidth / Math.max(1, prices.length) * .65))} height={p.volume! / maxVolume * 22} fill="#65879b" />)}
        {prices.length > 0 && prices.every(p => p.volume === null) && <text x={left + 8} y={volumeBottom-6}>{text("Volume not recorded", "未记录成交量")}</text>}
        <line x1={left} x2={right} y1={volumeBottom+2} y2={volumeBottom+2} stroke="var(--ui-line,#30485a)" />
        {showMacd&&<g data-macd-panel>
          <text x={0} y={macdTop-6}>{text('MACD','MACD')}</text>
          <line x1={left} x2={right} y1={macdY(0)} y2={macdY(0)} stroke="var(--ui-line,#30485a)"/>
          {[-macdExtent,0,macdExtent].map(value=><text key={value} x={left-7} y={macdY(value)+4} textAnchor="end">{value.toFixed(2)}</text>)}
          {macd.map(point=><rect data-macd-histogram={point.date} key={point.date} x={x(point.date)-candleWidth/2} y={Math.min(macdY(0),macdY(point.histogram))} width={candleWidth} height={Math.max(.5,Math.abs(macdY(point.histogram)-macdY(0)))} fill={point.histogram>=0?'var(--price-up,#55dfbb)':'var(--price-down,#ff8ea1)'}/>)}
          <path data-macd-dif d={indicatorPath(macd.map(point=>({date:point.date,value:point.dif})),macdY)} stroke={MA_COLORS[0]} fill="none" strokeWidth={1.5}/>
          <path data-macd-signal d={indicatorPath(macd.map(point=>({date:point.date,value:point.signal})),macdY)} stroke={MA_COLORS[1]} fill="none" strokeWidth={1.5}/>
          {!macd.length&&<text x={left+8} y={macdY(0)-8}>{text('Insufficient history','历史数据不足')}</text>}
        </g>}
        {tickDates.map(date => <text key={date} data-session-tick={date} x={x(date)} y={chartHeight-6} textAnchor="middle">{formatDate(date)}</text>)}
        {useCandles&&groups.map(group=>{
          const candle=candles.find(price=>price.date===group.events[0].date);if(!candle)return null;
          const above=group.y<y(candle.high),below=group.y>y(candle.low);if(!above&&!below)return null;
          return <line key={group.events[0].id} data-event-connector={group.events[0].date} x1={left+group.x} x2={left+group.x} y1={group.y+(above?group.size/2:-group.size/2)} y2={y(above?candle.high:candle.low)} stroke="var(--ui-muted,#9db4c8)" strokeDasharray="2 3" opacity={.35} pointerEvents="none"/>;
        })}
        {activeDate && <line x1={priceDate && nearest ? x(nearest.date) : x(activeDate)} x2={priceDate && nearest ? x(nearest.date) : x(activeDate)} y1={8} y2={volumeBottom+2} stroke="var(--ui-muted,#c4e8f4)" opacity={.55} />}
        {priceDate && nearest && <circle cx={x(nearest.date)} cy={y(nearest.close)} r={4} fill="var(--chart-line,#79cfe9)" stroke="#e5f7ff" strokeWidth={2} />}
      </svg>
      {priceDate && nearest && <div className={styles.priceTooltip} role="group" aria-label={text("Price details", "股价详情")} data-price-details style={{left:Math.max(tooltipHalfWidth+8,Math.min(width-tooltipHalfWidth-8,x(nearest.date))),top:4}}>
        <div className={styles.priceDetailsHeader}><span>{nearest.date}</span><button type="button" aria-label={text("Close price details", "关闭股价详情")} onClick={()=>closePriceDetails(true)}>×</button></div>
        {useCandles&&nearest.open!==undefined&&nearest.high!==undefined&&nearest.low!==undefined&&<span data-hover-ohlc>{text('O','开')} {nearest.open.toFixed(2)} · {text('H','高')} {nearest.high.toFixed(2)} · {text('L','低')} {nearest.low.toFixed(2)}</span>}
        <strong>{text("Close", "收盘价")} · {new Intl.NumberFormat(locale, data?.currency ? {style:"currency",currency:data.currency,minimumFractionDigits:2,maximumFractionDigits:2} : {minimumFractionDigits:2,maximumFractionDigits:2}).format(nearest.close)}</strong>
        {hoverReturn&&<span title={`${hoverReturn.baselineDate} → ${hoverReturn.latestDate}`}>{hoverReturn.adjacent?text('Daily change','当日涨跌幅'):`${text('Change since','较')} ${hoverReturn.baselineDate}`} · <b data-daily-return data-return-direction={hoverReturn.change>0?'up':hoverReturn.change<0?'down':'flat'}>{hoverReturn.change>0?'▲':hoverReturn.change<0?'▼':'—'} {signedPercent(hoverReturn.change)}</b></span>}
        {toLatest!==undefined&&latest&&<span title={`${nearest.date} → ${latest.date}`} data-latest-return>{text('Change to latest close','至最新收盘涨跌幅')} ({formatDate(latest.date)}) · <b data-return-direction={toLatest>0?'up':toLatest<0?'down':'flat'}>{toLatest>0?'▲':toLatest<0?'▼':'—'} {signedPercent(toLatest)}</b></span>}
        <span>{text("Volume", "成交量")} · {nearest.volume === null ? text("Not recorded", "未记录") : new Intl.NumberFormat(locale).format(nearest.volume)}</span>
        {movingAverages.map((points,index)=>{const point=points.find(point=>point.date===nearest.date);return averages.includes(MA_PERIODS[index])&&<span key={MA_PERIODS[index]} style={{color:MA_COLORS[index]}}>{text('MA','MA')}{MA_PERIODS[index]} · {point?.value.toFixed(2)??text('Insufficient history','历史数据不足')}</span>;})}
        {showMacd&&(()=>{const point=macd.find(point=>point.date===nearest.date);return point?<span>{text('MACD','MACD')} · {text('DIF','DIF')} {point.dif.toFixed(2)} · {text('DEA','DEA')} {point.signal.toFixed(2)} · {text('Hist','柱值')} {point.histogram.toFixed(2)}</span>:null;})()}
      </div>}
      {groups.map(group=>{const presentations=[...new Map(group.events.map(event=>{const p=eventPresentation(event,chinese);return [p.symbol+p.color,p] as const;})).values()],style=presentations[0],multiple=group.events.length>1;return <button key={group.events[0].id} className={styles.marker} data-event-type={presentations.length>1?'multiple':style.type} data-marker-size={group.size} data-event-count={group.events.length} type="button" style={{left:left+group.x,top:group.y,width:group.size,height:group.size,color:categoryColor(style.color),borderColor:categoryColor(style.color)}} title={group.events.map(e=>`${eventPresentation(e,chinese).label} · ${formatDate(e.date)}: ${e.title}`).join('; ')} aria-label={multiple?`${group.events.length} ${text('events','个事件')} · ${presentations.map(p=>p.label).join(' / ')} · ${formatDate(group.events[0].date)}`:`${formatDate(group.events[0].date)}: ${group.events[0].title}`} aria-pressed={group.events.some(e=>e.id===clusterId||e.id===selectedId)} onClick={e=>{if(multiple){setSelectedId('');onDismissEvent?.();setPriceSelection(null);chooserTrigger.current=e.currentTarget;setClusterAnchor(eventWindowAnchor(e));setClusterId(group.events[0].id);}else selectEvent(group.events[0].id,e);}} onPointerEnter={()=>{setHoverDate(group.events[0].date);}} onFocus={()=>{setPriceSelection(null);setHoverDate(group.events[0].date);}} onBlur={()=>{setHoverDate(null);}}><span className={styles.markerSymbols} data-mixed={presentations.length>1||undefined}>{presentations.slice(0,3).map(p=><span key={p.symbol+p.color} style={{color:categoryColor(p.color)}}>{p.symbol}</span>)}</span>{multiple&&<span className={styles.countBadge} aria-hidden="true">{group.events.length}</span>}</button>;})}
      {openCluster&&<FloatingEventWindow role="group" focusClose anchor={clusterAnchor} title={text('Choose an event','选择事件')} closeLabel={text('Close event list','关闭事件列表')} onClose={closeChooser}>
        <p>{openCluster.events.length} {text('events','个事件')} · {formatDate(openCluster.events[0].date)}</p>
        <div className={styles.eventList}>{openCluster.events.map(event=>{const style=eventPresentation(event,chinese);return <button key={event.id} type="button" onClick={click=>selectEvent(event.id,click)}><span style={{color:categoryColor(style.color)}}>{style.symbol} {style.label}</span> · {formatDate(event.date)} · {event.title}{returnFor(event.id)&&returnLabel(returnFor(event.id)!)}</button>;})}</div>
      </FloatingEventWindow>}
    </div>
    <p className={styles.coverage}>{chartMode==='candles'&&prices.length>0&&!useCandles&&<span>{text("OHLC unavailable; showing closes","暂无完整开高低收数据，显示收盘价")} · </span>}{activeDate && nearest ? `${formatDate(activeDate)} · ${text("Nearest stored close", "最近的已存储收盘价")} ${nearest.close.toFixed(2)} (${formatDate(nearest.date)}) · ${text("Volume", "成交量")} ${nearest.volume === null ? "—" : new Intl.NumberFormat(locale, { notation: "compact" }).format(nearest.volume)}` : prices.length ? `${prices.length} ${text("stored daily bars", "条已存储日线")} · ${formatDate(prices[0].date)} – ${formatDate(prices.at(-1)!.date)} · ${text("Close may be provider-adjusted", "收盘价可能为供应商复权价")}` : text("Events use source publication dates; missing prices are not filled.", "事件以资料发布日期排列；缺失股价不会填补。")}</p>
    {data && !data.available && <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}>{text("Retry prices", "重试读取股价")}</button>}
    {selected && !onSelectEvent && <FloatingEventWindow key={selected.id} anchor={eventAnchor} title={text('Event details','事件详情')} onClose={()=>{setSelectedId('');setHoverDate(null);}}>
      <strong>{eventPresentation(selected,chinese).symbol} {eventPresentation(selected,chinese).label}</strong><h2>{selected.title}</h2><p>{text('Published','发布于')} · {selected.date}</p>
      {selectedGroup && selectedGroup.events.length > 1 && <div className={styles.eventList}>{selectedGroup.events.map(event => <button key={event.id} type="button" aria-pressed={event.id === selected.id} onClick={click=>selectEvent(event.id,click)}>{formatDate(event.date)} · {event.title}</button>)}</div>}
      <p>{selected.description}</p>{selected.planned && <p>{text('Announced / planned; completion is not established.','已宣布／计划中；尚不代表已完成。')}</p>}{returnFor(selected.id)&&returnLabel(returnFor(selected.id)!)}<nav><a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{selected.sourceTitle} ↗</a></nav>
    </FloatingEventWindow>}
  </section>;
}

export function CompanyResearchTimeline({ company, graph, initialPrices }: { company: GraphNode; graph?: KnowledgeGraph; initialPrices?: TimelinePrices }) {
  return <div className={styles.pageResearch}><CompanySnapshot company={company} profileLink={false} /><CompanyTimeline companyId={company.id} graph={graph} initialPrices={initialPrices} /></div>;
}
