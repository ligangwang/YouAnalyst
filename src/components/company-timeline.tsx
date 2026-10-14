"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { adjacentTimelineBars, TIMELINE_RANGES, TIMELINE_RANGE_LABELS, TIMELINE_INTERVALS, resolvedTimelineInterval, timelinePriceBars, timelinePeriod, timelinePeriodEnd, tradingSessionAxis, layoutOverlayMarkers, companyTimelineEvents, timelineWindow, type TimelineIntervalChoice, type TimelineRange, type TimelineEvent, type TimelinePrices } from "@/lib/ui/company-timeline";
import { MA_PERIODS, MA_COLORS, movingAveragePeriods, simpleMovingAverage, movingAverageConvergence, stochasticKdj, bollingerBands, type IndicatorPoint } from '@/lib/ui/technical-indicators';
import { ChartSizeControls, useChartSize } from './chart-size-controls';
import { FloatingEventWindow, eventWindowAnchor, type EventWindowAnchor } from './event-details-window';
import {EVENT_TYPES,eventPresentation} from '@/lib/events/classification';
import { curatedEvents } from "@/lib/knowledge-graph/curated-events";
import type { GraphNode, KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";
import { CompanySnapshot } from "./company-snapshot";
import styles from "./company-timeline.module.css";
import {signedPercent,type EventPriceReturn} from '@/lib/intelligence/price-performance';
import type { CompanyThemeId } from '@/lib/company-themes/model';
import { chartShareUrl, companyResearchPath, parseSharedChart, sharedChartParams, type SharedChart } from '@/lib/ui/chart-share';
import { eventReturnDays } from '@/lib/ui/event-return-age';
import { useRelativeTimeClock } from './relative-time';
import { CompanySearch } from "./company-search";
import type { SearchSuggestion } from "./ticker-search-input";
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';

export function CompanyTimeline({ companyId: initialCompanyId, graph, initialPrices, events: originalEvents, onSelectEvent: originalSelectEvent,onDismissEvent,selectedEventId: originalEventId,eventReturns,shareTheme = 'ai', onPriceHistoryChange }: { onPriceHistoryChange?: (available: boolean) => void; companyId: string; shareTheme?: CompanyThemeId; graph?: KnowledgeGraph; initialPrices?: TimelinePrices; events?: TimelineEvent[]; onSelectEvent?: (id: string,anchor?:EventWindowAnchor) => void; onDismissEvent?:()=>void;selectedEventId?:string;eventReturns?:Record<string,EventPriceReturn[]> }) {
  const { text, chinese, locale } = useLocale();
  const [stockChoice, setStockChoice] = useState<{source: string; item: SearchSuggestion} | null>(null);
  const chosenStock = stockChoice?.source === initialCompanyId ? stockChoice.item : null;
  const companyId = chosenStock?.id ?? initialCompanyId;
  const suppliedEvents = chosenStock ? undefined : originalEvents;
  const onSelectEvent = chosenStock ? undefined : originalSelectEvent;
  const selectedEventId = chosenStock ? undefined : originalEventId;

  const researchPath=companyResearchPath(companyId,locale);
  useEffect(()=>{
    const openResearch=(event:KeyboardEvent)=>{
      if(event.key!=='F10'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
      event.preventDefault();event.stopPropagation();window.open(researchPath,'_blank','noopener,noreferrer');
    };
    document.addEventListener('keydown',openResearch);return ()=>document.removeEventListener('keydown',openResearch);
  },[researchPath]);
  const rangeLabel = (range: TimelineRange) => text(TIMELINE_RANGE_LABELS[range], ({30:'近1个月',90:'近3个月',180:'近6个月',ytd:'今年以来',365:'近1年',1826:'近5年'} as const)[range]);
  const intervalLabel=(value:TimelineIntervalChoice)=>text(({auto:'Auto',daily:'Daily',weekly:'Weekly',monthly:'Monthly',quarterly:'Quarterly',yearly:'Yearly'} as const)[value],({auto:'自动',daily:'日K',weekly:'周K',monthly:'月K',quarterly:'季K',yearly:'年K'} as const)[value]);
  const categoryColor = (color: string) => `color-mix(in srgb, ${color} var(--event-color-weight,100%), var(--ui-text,${color}))`;
  const chartHelpId = useId();
  const now = useRelativeTimeClock();
  const chartRange = useIndustryBrowseParam('chartRange');
  const chartInterval = useIndustryBrowseParam('chartInterval');
  const chartStyle = useIndustryBrowseParam('chartStyle');
  const chartMA = useIndustryBrowseParam('chartMA');
  const chartMacd = useIndustryBrowseParam('chartMacd');
  const chartIndicator = useIndustryBrowseParam('chartIndicator');
  const chartActivity = useIndustryBrowseParam('chartActivity');
  const chartEvents = useIndustryBrowseParam('chartEvents');
  const sharedEventId = useIndustryBrowseParam('chartEvent');
  const settings = parseSharedChart(new URLSearchParams({chartRange,chartInterval,chartStyle,chartMA,chartMacd,chartIndicator,chartActivity,chartEvents}));
  const { range: days, averages, macd: showMacd, indicator, activity, events: showEvents, style: chartMode } = settings;
  const interval=resolvedTimelineInterval(days,settings.interval),aggregated=interval!=='daily';
  const periodChangeLabel=text(({daily:'Daily change',weekly:'Weekly change',monthly:'Monthly change',quarterly:'Quarterly change',yearly:'Yearly change'} as const)[interval],({daily:'当日涨跌幅',weekly:'周涨跌幅',monthly:'月涨跌幅',quarterly:'季度涨跌幅',yearly:'年度涨跌幅'} as const)[interval]);
  const barsLabel=text(({daily:'stored daily bars',weekly:'weekly bars',monthly:'monthly bars',quarterly:'quarterly bars',yearly:'yearly bars'} as const)[interval],({daily:'条已存储日线',weekly:'条周线',monthly:'条月线',quarterly:'条季线',yearly:'条年线'} as const)[interval]);
  const showKdj=indicator==='kdj',showBoll=indicator==='boll',showOscillator=showMacd||showKdj||showBoll;
  const [shareResult,setShareResult] = useState<{url:string;copied:boolean}|null>(null);
  const changeSettings = (patch: Partial<SharedChart>) => { updateIndustryBrowse(sharedChartParams({...settings,...patch})); setShareResult(null); };
  const setDays = (range: TimelineRange) => changeSettings({range});
  const setChartMode = (style: 'candles'|'line') => changeSettings({style});
  const setAverages = (change: (values:number[])=>number[]) => changeSettings({averages:change(averages)});
  const setShowEvents = (change: (value:boolean)=>boolean) => changeSettings({events:change(showEvents)});
  const {size:chartSize,setSize:setChartSize,root:chartSizeRef,viewportHeight} = useChartSize();
  const previousSize = useRef(chartSize);
  useEffect(() => {
    if (previousSize.current === 'full' && chartSize !== 'full' && chosenStock) {
      const destination = new URL(researchPath, location.origin);
      for (const [key, value] of Object.entries(sharedChartParams(settings))) destination.searchParams.set(key, value);
      destination.hash = 'company-timeline';
      location.assign(destination.pathname + destination.search + destination.hash);
    }
    previousSize.current = chartSize;
  }, [chartSize, chosenStock, researchPath, settings]);
  const needsHistory = averages.length>0 || indicator!=='none';
  const averagePeriods=[...new Set([...MA_PERIODS,...averages])].sort((a,b)=>a-b);
  const maxAverage=Math.max(60,...averages);
  const [maSettings,setMaSettings]=useState<EventWindowAnchor|null>(null);
  const [viewport,setViewport]=useState({key:'',zoom:1,offset:0});
  const [closed, setClosed] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; data: TimelinePrices; indicatorError?:boolean } | null>(null);
  const [loadedGraph, setLoadedGraph] = useState<KnowledgeGraph | null>(null);
  const [retry, setRetry] = useState(0);
  const localSelectedId = sharedEventId;
  const setSelectedId = (id:string) => { if(!onSelectEvent) updateIndustryBrowse({chartEvent:id}); setShareResult(null); };
  const [eventAnchor,setEventAnchor] = useState<EventWindowAnchor|null>(null);
  const selectedId=selectedEventId??localSelectedId;
  const copyChartLink = async () => {
    const url = chartShareUrl(companyId,locale,settings,showEvents?selectedId:'',Boolean(onSelectEvent),shareTheme);
    try { await navigator.clipboard.writeText(url); setShareResult({url,copied:true}); }
    catch { setShareResult({url,copied:false}); }
  };
  const [clusterId,setClusterId]=useState('');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [priceSelection, setPriceSelection] = useState<{companyId:string;date:string} | null>(null);
  const [hoverPrice,setHoverPrice]=useState<{companyId:string;date:string}|null>(null);
  const priceDate = priceSelection?.companyId === companyId ? priceSelection.date : hoverPrice?.companyId===companyId?hoverPrice.date:null;
  const hoverOnly=priceSelection?.companyId!==companyId&&hoverPrice?.companyId===companyId;
  const [width, setWidth] = useState(600);
  const chart = useRef<HTMLDivElement>(null);
  const [clusterAnchor,setClusterAnchor] = useState<EventWindowAnchor|null>(null);
  const closePriceDetails = (restoreFocus = false) => {
    setPriceSelection(null);
    setHoverPrice(null);
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
  const key = `${companyId}:${days}:${interval}:${needsHistory}:${maxAverage}:${retry}`;
  const compatibleInterval=(value:TimelinePrices)=>value.interval===interval||(value.interval??'daily')==='daily';
  const matchingInitial = initialPrices?.companyId===companyId && compatibleInterval(initialPrices) && initialPrices.start<=timelineWindow(days,initialPrices.end).start ? initialPrices : null;
  const initialHistoryReady = Boolean(matchingInitial && (matchingInitial.interval===interval?[...(matchingInitial.warmupPrices??[]),...matchingInitial.prices].filter(price=>price.date<timelineWindow(days,matchingInitial.end).start):timelinePriceBars([...(matchingInitial.warmupPrices??[]),...matchingInitial.prices],timelineWindow(days,matchingInitial.end).start,interval).warmupPrices).length>=maxAverage);
  useEffect(() => {
    if (matchingInitial && (!needsHistory || initialHistoryReady)) return;
    const controller = new AbortController();
    fetch(`/api/company-timeline?company=${encodeURIComponent(companyId)}&days=${days}&interval=${interval}${needsHistory?'&indicators=1':''}${needsHistory&&maxAverage>60?`&maPeriod=${maxAverage}`:''}`, { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok || !data || data.available===false || data.companyId !== companyId || !Array.isArray(data.prices) || (data.interval&&data.interval!==interval&&data.interval!=='daily')) throw new Error(); return data as TimelinePrices; })
      .then(data => setLoaded({ key, data }))
      .catch(() => { if (!controller.signal.aborted) {const fallback=matchingInitial?.prices.length?matchingInitial:null;setLoaded({key,data:fallback??{companyId,...timelineWindow(days),currency:null,prices:[],available:false},indicatorError:Boolean(fallback&&needsHistory)});} });
    return () => controller.abort();
  }, [companyId, days, interval, matchingInitial, initialHistoryReady, needsHistory, maxAverage, key]);
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
  const data = loaded?.key===key ? loaded.data : matchingInitial ?? (loaded?.data.companyId===companyId && compatibleInterval(loaded.data) && loaded.data.start===timelineWindow(days,loaded.data.end).start ? loaded.data : null);
  const { start:rangeStart, end:rangeEnd } = timelineWindow(days, data?.end);
  const events = useMemo(() => suppliedEvents ?? companyTimelineEvents(companyId, graph ?? loadedGraph, curatedEvents, chinese), [suppliedEvents, companyId, graph, loadedGraph, chinese]);
  const left = width < 440 ? 60 : 72, right = Math.max(left + 1, width - 24), plotWidth = right - left;
  const rawHistory=[...new Map([...(data?.warmupPrices??[]),...(data?.prices??[])].map(price=>[price.date,price])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  const hasPriceHistory = rawHistory.length > 0;
  useEffect(() => { if (!chosenStock) onPriceHistoryChange?.(hasPriceHistory); }, [onPriceHistoryChange, hasPriceHistory, chosenStock]);
  const periodHistory=timelinePriceBars(rawHistory,rangeStart,interval);
  const history=aggregated&&data?.interval!==interval?[...periodHistory.warmupPrices,...periodHistory.prices]:rawHistory;
  const allPrices = history.filter(p => p.date >= rangeStart && p.date <= rangeEnd).sort((a,b)=>a.date.localeCompare(b.date));
  const viewKey=`${companyId}:${days}:${interval}`;
  const view=viewport.key===viewKey?viewport:{key:viewKey,zoom:1,offset:0};
  const visibleCount=Math.min(allPrices.length,Math.max(5,Math.ceil(allPrices.length/view.zoom)));
  const offset=Math.min(Math.max(0,allPrices.length-visibleCount),view.offset);
  const prices=allPrices.slice(Math.max(0,allPrices.length-visibleCount-offset),allPrices.length-offset);
  const start=view.zoom>1?prices[0]?.date??rangeStart:rangeStart,end=view.zoom>1&&offset>0?prices.at(-1)?.date??rangeEnd:rangeEnd;
  // Aggregate bars retain every publication in their calendar period when zoomed,
  // including pre-close dates and weekend disclosures at a panned right edge.
  const eventStart=aggregated&&view.zoom>1&&prices.length?[rangeStart,timelinePeriod(prices[0].date,interval)].sort().at(-1)!:start;
  const eventEnd=aggregated&&view.zoom>1&&offset>0&&prices.length?[rangeEnd,timelinePeriodEnd(prices.at(-1)!.date,interval)].sort()[0]:end;
  const axis = tradingSessionAxis(prices.map(price=>price.date),start,end);
  const periodDates=new Map(prices.map(price=>[timelinePeriod(price.date,interval),price.date]));
  const barDate=(date:string)=>aggregated?(periodDates.get(timelinePeriod(date,interval))??date):date;
  const x = (date: string) => left + axis.ratio(barDate(date)) * plotWidth;
  const tickCount = width < 440 ? 3 : 5;
  const tickDates = [...new Set(Array.from({length:tickCount},(_,i)=>axis.dateAt(i/(tickCount-1))))];
  const small=width<440,priceTop=24,priceBottom=chartSize==='compact'?(small?164:140):Math.max(160,Math.floor(viewportHeight*(chartSize==='full'?.65:.4))-56-(showOscillator?100:0)),volumeBottom=priceBottom+32,chartHeight=volumeBottom+24+(showOscillator?100:0);
  const selected = events.find(e => e.id === selectedId && e.date >= eventStart && e.date <= eventEnd);
  const activeDate = priceDate ?? (hoverDate && hoverDate >= eventStart && hoverDate <= eventEnd ? hoverDate : selected?.date);
  const candles=prices.filter((price):price is typeof price&{open:number;high:number;low:number}=>price.open!==undefined&&price.high!==undefined&&price.low!==undefined);
  const useCandles=chartMode==='candles'&&candles.length>0;
  const movingAverages = averagePeriods.map(period=>simpleMovingAverage(history,period).filter(point=>point.date>=start&&point.date<=end));
  const macd = movingAverageConvergence(history).filter(point=>point.date>=start&&point.date<=end);
  const kdj=stochasticKdj(history).filter(point=>point.date>=start&&point.date<=end);
  const boll=bollingerBands(history).filter(point=>point.date>=start&&point.date<=end);
  const averageValues = movingAverages.flatMap((points,index)=>averages.includes(averagePeriods[index])?points.map(point=>point.value):[]);
  const min = prices.length ? Math.min(...prices.map(p => useCandles?p.low??p.close:p.close),...averageValues) : 0, max = prices.length ? Math.max(...prices.map(p => useCandles?p.high??p.close:p.close),...averageValues) : 1;
  const candleWidth=Math.max(2,Math.min(10,plotWidth/Math.max(1,prices.length)*.65));
  const pad = Math.max((max - min) * .1, max * .01), low = Math.max(0, min - pad), high = max + pad;
  // Keep a compact escape row above the full wick range, within the existing chart height.
  const headroom=useCandles&&showEvents&&events.some(event=>event.date>=eventStart&&event.date<=eventEnd)?Math.min(40,(priceBottom-priceTop)*.3):0;
  const y = (value: number) => priceBottom - (value - low) / Math.max(.001, high - low) * (priceBottom-priceTop-headroom);
  const groups=layoutOverlayMarkers(showEvents?events:[],eventStart,eventEnd,plotWidth,priceTop,priceBottom,useCandles?[]:prices.map(price=>({x:x(price.date)-left,y:y(price.close)})),small?34:26,date=>x(date)-left,useCandles?prices.map(price=>({left:x(price.date)-left-candleWidth/2,right:x(price.date)-left+candleWidth/2,top:y(price.high??price.close),bottom:y(price.low??price.close)})):[],aggregated?date=>timelinePeriod(date,interval):undefined);
  const openCluster=groups.find(group=>group.events.some(event=>event.id===clusterId));
  const selectedGroup=groups.find(group=>group.events.some(event=>event.id===selectedId));
  const activityValue=(price:typeof prices[number])=>activity==='turnover'?price.amount??null:price.volume;
  const activityLabel=activity==='turnover'?text('Turnover','成交额'):text('Volume','成交量');
  const maxVolume = Math.max(1, ...prices.map(p => activityValue(p) ?? 0));
  const hasPriceGap=(previous:string,current:string)=>aggregated?!adjacentTimelineBars(previous,current,interval):Date.parse(current)-Date.parse(previous)>7*86_400_000;
  const pricePath = prices.map((p, index) => { const command = index === 0 || hasPriceGap(prices[index-1].date,p.date) ? "M" : "L"; return `${command}${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`; }).join(" ");
  // Bridge long intervals without implying that daily bars were recorded inside them.
  const gapPath = prices.flatMap((p,index)=>index>0&&hasPriceGap(prices[index-1].date,p.date)
    ? [`M${x(prices[index-1].date).toFixed(2)},${y(prices[index-1].close).toFixed(2)} L${x(p.date).toFixed(2)},${y(p.close).toFixed(2)}`]:[]).join(" ");
  const nearest = activeDate ? prices.reduce<(typeof prices)[number] | null>((best, p) => !best || Math.abs(Date.parse(p.date) - Date.parse(barDate(activeDate))) < Math.abs(Date.parse(best.date) - Date.parse(barDate(activeDate))) ? p : best, null) : null;
  const formatDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { ...(days===1826||aggregated?{year:'numeric' as const}:{}), month: "short", day: "numeric", timeZone: "UTC" });
  const formatTickDate=(date:string)=>interval==='yearly'?date.slice(0,4):interval==='quarterly'?text(`${date.slice(0,4)} Q${Math.ceil(Number(date.slice(5,7))/3)}`,`${date.slice(0,4)}年第${Math.ceil(Number(date.slice(5,7))/3)}季度`):interval==='monthly'?new Date(`${date}T00:00:00Z`).toLocaleDateString(locale,{year:'numeric',month:'short',timeZone:'UTC'}):formatDate(date);
  const selectEvent = (id: string,click?:React.MouseEvent<HTMLButtonElement>) => { const anchor=click?eventWindowAnchor(click):null;if(anchor&&clusterId&&chooserTrigger.current?.isConnected)anchor.trigger=chooserTrigger.current;setEventAnchor(anchor);setPriceSelection(null); setSelectedId(id);if(clusterId)closeChooser(); setHoverDate(null); onSelectEvent?.(id,anchor??undefined); };
  const selectPriceAt = (clientX: number) => {
    const rect = chart.current?.getBoundingClientRect(); if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - left) / plotWidth));
    if (prices.length) { setClusterId(''); setPriceSelection({companyId,date:axis.dateAt(ratio)}); }
  };
  const returnFor=(id:string)=>eventReturns?.[id]?.find(value=>value.companyId===companyId);
  const dailyReturnFor=(date:string)=>{
    const index=allPrices.findIndex(price=>price.date===date);
    if(index<1)return;
    const current=allPrices[index],previous=allPrices[index-1];
    // A weekday gap may be a holiday or missing history; do not infer a daily return.
    const adjacent=adjacentTimelineBars(previous.date,current.date,interval);
    return {baselineDate:previous.date,latestDate:current.date,change:current.close/previous.close-1,adjacent};
  };
  const hoverReturn=nearest?dailyReturnFor(nearest.date):undefined;
  const latest=allPrices.at(-1);
  const sessionIndex=new Map(prices.map((price,index)=>[price.date,index]));
  const indicatorPath=(points:IndicatorPoint[],valueY:(value:number)=>number)=>points.map((point,index)=>`${index===0||(sessionIndex.get(point.date)??0)!==(sessionIndex.get(points[index-1].date)??0)+1?'M':'L'}${x(point.date).toFixed(2)},${valueY(point.value).toFixed(2)}`).join(' ');
  const macdTop=volumeBottom+32,macdBottom=chartHeight-24;
  const macdExtent=Math.max(.001,...macd.flatMap(point=>[Math.abs(point.dif),Math.abs(point.signal),Math.abs(point.histogram)]))*1.1;
  const macdY=(value:number)=>macdTop+(macdBottom-macdTop)/2-value/macdExtent*(macdBottom-macdTop)/2;
  const kdjLow=Math.min(0,...kdj.flatMap(point=>[point.k,point.d,point.j]))-5,kdjHigh=Math.max(100,...kdj.flatMap(point=>[point.k,point.d,point.j]))+5;
  const kdjY=(value:number)=>macdBottom-(value-kdjLow)/(kdjHigh-kdjLow)*(macdBottom-macdTop);
  const bollValues=[...boll.flatMap(point=>[point.lower,point.upper]),...prices.flatMap(price=>useCandles?[price.low??price.close,price.high??price.close]:[price.close])];
  const bollMin=bollValues.length?Math.min(...bollValues):0,bollMax=bollValues.length?Math.max(...bollValues):1;
  const bollPad=Math.max((bollMax-bollMin)*.1,Math.abs(bollMax)*.01,.001),bollLow=bollMin-bollPad,bollHigh=bollMax+bollPad;
  const bollY=(value:number)=>macdBottom-(value-bollLow)/(bollHigh-bollLow)*(macdBottom-macdTop);
  const toLatest=nearest&&latest&&nearest.close>0?latest.close/nearest.close-1:undefined;
  const totalBars=allPrices.length;
  const zoomView=useCallback((direction:number,ratio=.5)=>{
    setViewport(previous=>{
      const old=previous.key===viewKey?previous:{key:viewKey,zoom:1,offset:0},total=totalBars;
      const zoom=Math.max(1,Math.min(16,old.zoom*(direction>0?2:.5)));
      const oldCount=Math.min(total,Math.max(5,Math.ceil(total/old.zoom))),count=Math.min(total,Math.max(5,Math.ceil(total/zoom)));
      if(count===oldCount)return old;
      const oldOffset=Math.min(Math.max(0,total-oldCount),old.offset),anchor=total-oldCount-oldOffset+ratio*Math.max(0,oldCount-1);
      const first=Math.max(0,Math.min(total-count,Math.round(anchor-ratio*Math.max(0,count-1))));
      return {key:viewKey,zoom,offset:total-count-first};
    });setHoverPrice(null);setPriceSelection(null);setHoverDate(null);setClusterId('');
  },[totalBars,viewKey]);
  useEffect(()=>{
    const element=chart.current;if(!element)return;
    let last=0;
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey||!event.deltaY||!(event.target instanceof Element)||!event.target.closest('svg'))return;
      event.preventDefault();event.stopPropagation();
      if(Date.now()-last<100)return;last=Date.now();
      const bounds=element.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(event.clientX-bounds.left-left)/plotWidth));
      zoomView(event.deltaY<0?1:-1,ratio);
    };
    element.addEventListener('wheel',wheel,{passive:false});return ()=>element.removeEventListener('wheel',wheel);
  },[closed,left,plotWidth,zoomView]);
  const returnLabel=(value:EventPriceReturn,event:Pick<TimelineEvent,'date'|'publishedAt'>)=>{
    const publicationDate=event.date;
    const days=eventReturnDays(publicationDate,value.latestDate,event.publishedAt,now,value.companyId);
    const label=`${text('Since pub.','发布以来')}${days===null||days<1?'':` (${days}${text('d','天')})`}:`;
    const hint=`${label} ${signedPercent(value.change)} · ${text('Published','发布于')} ${publicationDate} · ${text('Price baseline','价格基准')}: ${value.baselineDate} → ${value.latestDate} · ${text('Last completed close before publication; excludes dividend and split adjustments.','使用发布前最后一个完整交易日的收盘价；不含股息与拆股调整。')}`;
    return <span className={styles.chooserReturn} data-return-direction={value.change>0?'up':value.change<0?'down':'flat'} title={hint} aria-label={hint}>{`${label} `}{value.change>0?'▲':value.change<0?'▼':'—'} {signedPercent(value.change)}</span>;
  };
  if (closed) return <section className={styles.timeline} data-company-timeline={companyId}><button ref={toggleButton} className={styles.retry} type="button" onClick={() => toggleTimeline(false)}>{text("Show timeline", "显示时间轴")}</button></section>;
  return <section id="company-timeline" ref={chartSizeRef} className={styles.timeline} role={chartSize==='full'?'dialog':undefined} aria-modal={chartSize==='full'||undefined} tabIndex={-1} data-chart-size={chartSize} aria-label={text("Company event and price timeline", "公司事件与股价时间轴")} data-company-timeline={companyId}>
    <header className={styles.header}><h2>{chosenStock ? `${chosenStock.name} · ${chosenStock.symbol}` : text("Events, price & volume", "事件、股价与成交量")}</h2><div className={styles.ranges} role="group" aria-label={text("Timeline range", "时间范围")}><div role="group" aria-label={text('Chart type','图表类型')} className={styles.chartModes}><button type="button" aria-pressed={chartMode==='candles'} onClick={()=>setChartMode('candles')}>{text('Candles','蜡烛图')}</button><button type="button" aria-pressed={chartMode==='line'} onClick={()=>setChartMode('line')}>{text('Line','曲线')}</button></div><span>{rangeLabel(days)}</span><button ref={toggleButton} type="button" aria-label={text("Close timeline", "关闭时间轴")} onClick={() => toggleTimeline(true)}>×</button></div></header>
    <div className={styles.tools}>
      <a href={researchPath} target="_blank" rel="noopener noreferrer" title={text('Open company research in a new tab','在新标签页打开公司研究页')}>{text('Fundamentals (F10)','基本面（F10）')}</a>
      <button type="button" onClick={()=>void copyChartLink()}>{text('Copy chart link','复制图表链接')}</button>
      <CompanySearch iconOnly owner="chart" enabled={chartSize==='full'} onSelect={item=>{setStockChoice(item.id===initialCompanyId?null:{source:initialCompanyId,item});setPriceSelection(null);setHoverPrice(null);setClusterId('');setHoverDate(null);setEventAnchor(null);setSelectedId('');onDismissEvent?.();setShareResult(null);}}/>
      <ChartSizeControls iconOnly size={chartSize} onChange={setChartSize}/>
      <label>{text('Range','时间范围')} <select aria-label={text('Price history range','股价时间范围')} value={days} onChange={event=>{setDays(event.target.value==='ytd'?'ytd':Number(event.target.value) as TimelineRange);setPriceSelection(null);setClusterId('');setHoverDate(null);}}>{TIMELINE_RANGES.map(range=><option key={range} value={range}>{rangeLabel(range)}</option>)}</select></label>
      <label>{text('Interval','K线周期')} <select aria-label={text('Candlestick interval','K线周期')} value={settings.interval} onChange={event=>{changeSettings({interval:event.target.value as TimelineIntervalChoice});closePriceDetails();setClusterId('');setHoverDate(null);}}>{(['auto',...TIMELINE_INTERVALS] as const).map(value=><option key={value} value={value}>{intervalLabel(value)}</option>)}</select></label>
      <div role="group" aria-label={text('Technical indicators','技术指标')} className={styles.indicatorControls}>
        {averagePeriods.map((period,index)=><button type="button" key={period} aria-pressed={averages.includes(period)} style={{color:MA_COLORS[index]}} onClick={()=>setAverages(values=>values.includes(period)?values.filter(value=>value!==period):movingAveragePeriods([...values,period]))}>{text('MA','MA')}{period}</button>)}
        <button type="button" onClick={click=>setMaSettings(eventWindowAnchor(click))}>{text('MA settings','均线设置')}</button>
        <button type="button" aria-pressed={showEvents} onClick={()=>{setShowEvents(value=>!value);setClusterId('');setHoverDate(null);}}>{text('Events','事件')}</button>
      </div>
      <div className={styles.indicatorSwitches}>
        <div role="group" aria-label={text('Trading activity','交易活跃度')} className={styles.indicatorControls}>
          <button type="button" aria-pressed={activity==='volume'} onClick={()=>changeSettings({activity:'volume'})}>{text('Volume','成交量')}</button>
          <button type="button" aria-pressed={activity==='turnover'} onClick={()=>changeSettings({activity:'turnover'})}>{text('Turnover','成交额')}</button>
        </div>
        <div role="group" aria-label={text('Chart indicator','图表指标')} className={styles.indicatorControls}>
          {(['macd','kdj','boll'] as const).map(value=><button key={value} type="button" aria-pressed={indicator===value} title={value==='macd'?text('DIF = EMA12 − EMA26; DEA = EMA9(DIF); histogram = DIF − DEA','DIF = EMA12 − EMA26；DEA = DIF 的 EMA9；柱值 = DIF − DEA'):value==='kdj'?text('RSV 9; K/D smoothing 3; J = 3K − 2D','RSV 9周期；K/D 平滑3周期；J = 3K − 2D'):text('SMA20 ± 2 population standard deviations','20周期均价 ± 2倍总体标准差')} onClick={()=>{const next=indicator===value?'none':value;changeSettings({indicator:next,macd:next==='macd'});}}>{value==='macd'?'MACD (12,26,9)':value==='kdj'?'KDJ (9,3,3)':'BOLL (20,2)'}</button>)}
        </div>
      </div>
      <span className={styles.zoomHint}>{text('Wheel / ↑↓ zoom · ←→ pan','滚轮／↑↓ 缩放 · ←→ 平移')}{view.zoom>1&&<button type="button" onClick={()=>{setViewport({key:viewKey,zoom:1,offset:0});closePriceDetails();setClusterId('');}}>{text('Reset view','重置视图')}</button>}</span>
    </div>
    {maSettings&&<FloatingEventWindow role="dialog" anchor={maSettings} title={text('Moving average settings','均线设置')} closeLabel={text('Close MA settings','关闭均线设置')} onClose={()=>setMaSettings(null)}>
      <form className={styles.maSettings} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);setAverages(()=>movingAveragePeriods(Array.from({length:8},(_,index)=>Number(form.get(`ma-${index}`)))));setMaSettings(null);}}>
        <p>{text('MA periods count bars in the selected interval. Set 0 to disable a line.','均线周期按所选K线的根数计算。填 0 关闭该线。')}</p>
        {Array.from({length:8},(_,index)=><label key={index}>{text('Line','第')}{index+1}{chinese?'条':''}<input name={`ma-${index}`} type="number" min={0} max={500} step={1} defaultValue={averages[index]??0}/></label>)}
        <button type="submit">{text('Apply','应用')}</button>
      </form>
    </FloatingEventWindow>}
    {shareResult&&<div className={styles.status} role="status">{shareResult.copied?text('Chart link copied','图表链接已复制'):text('Copy this chart link:','请复制此图表链接：')}{!shareResult.copied&&<input aria-label={text('Chart link','图表链接')} readOnly value={shareResult.url} onFocus={event=>event.target.select()} style={{width:'100%'}}/>}<button type="button" aria-label={text('Dismiss share message','关闭分享提示')} onClick={()=>setShareResult(null)}>×</button></div>}
    {needsHistory&&loaded?.key!==key&&!initialHistoryReady&&<p className={styles.status} role="status">{text('Loading indicator history…','正在加载指标历史数据…')}</p>}
    {loaded?.key===key&&loaded.indicatorError&&<p className={styles.status} role="status">{text('Indicator history unavailable; showing supplied prices.','指标历史数据暂时不可用，保留已有股价数据。')} <button type="button" onClick={()=>setRetry(value=>value+1)}>{text('Retry indicator history','重试指标历史数据')}</button></p>}
    {needsHistory&&loaded?.key===key&&averages.some(period=>!movingAverages[averagePeriods.indexOf(period)]?.length)&&<p className={styles.status}>{text('Some moving averages have insufficient stored history.','部分均线的已存储历史数据不足。')}</p>}
    {showMacd&&<div className={styles.indicatorLegend}><span style={{color:MA_COLORS[0]}}>{text('DIF','DIF')}</span><span style={{color:MA_COLORS[1]}}>{text('DEA','DEA')}</span><span>{text('Histogram = DIF − DEA','柱值 = DIF − DEA')}</span></div>}
    {showKdj&&<div className={styles.indicatorLegend}>{['K','D','J'].map((label,index)=><span key={label} style={{color:MA_COLORS[index]}}>{label}</span>)}</div>}
    {showBoll&&<div className={styles.indicatorLegend}>{[text('Upper','上轨'),text('Middle','中轨'),text('Lower','下轨')].map((label,index)=><span key={label} style={{color:MA_COLORS[index]}}>{label}</span>)}{!boll.length&&<span>{text('Insufficient history','历史数据不足')}</span>}</div>}
    {showEvents&&<div className={styles.legend}>{EVENT_TYPES.map(eventType=>{const style=eventPresentation({eventType},chinese);return <span key={eventType} style={{color:categoryColor(style.color)}}>{style.symbol} {style.typeLabel}</span>;})}</div>}
    <div ref={chart} className={styles.chart} style={{height:chartHeight}} data-chart-zoom={view.zoom} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();if(clusterId)closeChooser();else closePriceDetails(true);}}} onClick={e => { if (('pointerType' in e.nativeEvent ? e.nativeEvent.pointerType==='touch' : window.matchMedia('(pointer:coarse)').matches) && !(e.target as Element).closest("button,[data-price-details],[data-event-chooser]")) selectPriceAt(e.clientX); }} onPointerLeave={() => {setHoverDate(null);setHoverPrice(null);}} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <svg tabIndex={0} aria-describedby={chartHelpId} onPointerEnter={e=>{if(e.pointerType==='mouse')e.currentTarget.focus({preventScroll:true});}} onPointerLeave={()=>setHoverPrice(null)} onPointerMove={e=>{
        if(e.pointerType!=='mouse'||!(e.target instanceof Element))return;
        const candle=e.target.closest('[data-price-candle]');
        const line=e.target.closest('[data-price-line],[data-price-hit]');
        const rect=e.currentTarget.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-rect.left-left)/plotWidth));
        const date=candle?.getAttribute('data-price-candle')??(line&&prices.length?axis.dateAt(ratio):null);
        if(date)setPriceSelection(null);
        setHoverPrice(previous=>date?previous?.companyId===companyId&&previous.date===date?previous:{companyId,date}:null);
      }} onKeyDown={e=>{
        if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();zoomView(e.key==='ArrowUp'?1:-1);return;}
        if(view.zoom>1&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();e.stopPropagation();setViewport({key:viewKey,zoom:view.zoom,offset:Math.max(0,Math.min(allPrices.length-visibleCount,offset+(e.key==='ArrowLeft'?1:-1)*Math.max(1,Math.floor(visibleCount/4))))});closePriceDetails();return;}
        if (!prices.length || !['Enter',' ','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();
        const current = Math.max(0,prices.findIndex(price=>price.date===(priceDate??prices.at(-1)!.date)));
        const index = e.key==='Home'?0:e.key==='End'?prices.length-1:Math.max(0,Math.min(prices.length-1,current+(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0)));
        setClusterId(''); setPriceSelection({companyId,date:prices[index].date});
      }} data-time-axis={prices.length?"trading-sessions":"calendar"} data-chart-interval={interval} data-chart-type={useCandles?"candles":"line"} data-event-layout="overlay" data-price-top={priceTop} data-price-bottom={priceBottom} style={{height:chartHeight}} viewBox={`0 0 ${width} ${chartHeight}`} role="img" aria-label={useCandles?text(`Dated event markers over ${interval} candlesticks, with volume below`,`事件叠加在${intervalLabel(interval)}图中，下方为成交量`):text("Dated event markers over closing prices, with volume below", "事件按发布日期叠加在收盘价图中，下方为成交量")}>
        <desc id={chartHelpId}>{text("Hover over a candle or line to view details; moving away hides them. Use wheel or up/down keys to zoom; left/right keys pan when zoomed. Touch screens: tap to view. Enter opens keyboard details; Escape closes.","鼠标移到K线或曲线上显示详情，移开消失。滚轮或上下键缩放，放大后左右键平移。触屏点击查看；回车打开键盘详情，Esc 关闭。")}</desc>
        <text x={0} y={priceTop-8}>{useCandles?text("Price","股价"):text("Close", "收盘价")} {data?.currency === "USD" ? "($)" : data?.currency ?? ""}</text>
        {prices.length > 0 ? <>
          {[low, (low + high) / 2, high].map(value => <g key={value}><text x={left - 7} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(locale, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value)}</text><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--ui-line,#263c4e)" /></g>)}
          {latest&&<g data-latest-close-reference>{latest.close>=low&&latest.close<=high&&<line x1={left} x2={right} y1={y(latest.close)} y2={y(latest.close)} stroke="var(--chart-reference,#c9b879)" strokeWidth={1} strokeDasharray="2 4"/>}<text x={right} y={priceTop-8} textAnchor="end" style={{fill:'var(--chart-reference,#c9b879)',fontSize:10}}>{text('Latest close','最新收盘')} {new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(latest.close)}</text></g>}
          {useCandles?candles.map(price=>{const color=price.close>price.open?'var(--price-up,#55dfbb)':price.close<price.open?'var(--price-down,#ff8ea1)':'var(--price-flat,#b8cfe1)';return <g key={price.date} data-price-candle={price.date} data-candle-direction={price.close>price.open?'up':price.close<price.open?'down':'flat'}><path data-candle-hit d={`M${x(price.date)},${Math.min(y(price.high),y(price.close)-3)}L${x(price.date)},${Math.max(y(price.low),y(price.close)+3)}`} stroke="transparent" strokeWidth={Math.max(candleWidth,Math.min(12,plotWidth/prices.length*.8))} fill="none"/><line x1={x(price.date)} x2={x(price.date)} y1={y(price.high)} y2={y(price.low)} stroke={color}/><rect x={x(price.date)-candleWidth/2} y={Math.min(y(price.open),y(price.close))} width={candleWidth} height={Math.max(1,Math.abs(y(price.open)-y(price.close)))} fill={color}/></g>}):<><path data-price-hit d={pricePath} fill="none" stroke="transparent" strokeWidth={12}/><path data-price-line d={pricePath} fill="none" stroke="var(--chart-line,#79cfe9)" strokeWidth={2} /></>}
          {!useCandles&&gapPath&&<path data-price-gap d={gapPath} fill="none" stroke="var(--chart-line,#79cfe9)" strokeWidth={2} strokeDasharray="4 4" />}
          {movingAverages.map((points,index)=>averages.includes(averagePeriods[index])&&<path key={averagePeriods[index]} data-moving-average={averagePeriods[index]} d={indicatorPath(points,y)} fill="none" stroke={MA_COLORS[index]} strokeWidth={1.5} pointerEvents="none"/>)}
          {prices.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.close)} r={useCandles?(p.open===undefined?2:0):prices.length < 3 ? 3 : 1} fill="var(--chart-line,#79cfe9)" pointerEvents="none"/>)}
        </> : <text x={left + 8} y={volumeBottom-8}>{!data ? text("Loading stored prices…", "正在读取历史股价…") : !data.available ? text("Stored prices unavailable", "历史股价暂时无法读取") : companyId.startsWith("ORG:") ? text("No supported price history", "暂无支持的股价记录") : text("No stored prices in this range", "此范围暂无已存储股价")}</text>}
        <text x={0} y={volumeBottom-12}>{activityLabel}{activity==='turnover'&&data?.currency?` (${data.currency})`:''}</text>
        {prices.filter(p => activityValue(p) !== null).map(p => <rect key={p.date} data-volume-bar={activity==='volume'?p.date:undefined} data-turnover-bar={activity==='turnover'?p.date:undefined} data-volume-direction={p.open===undefined?'flat':p.close>p.open?'up':p.close<p.open?'down':'flat'} x={x(p.date) - 1} y={volumeBottom - activityValue(p)! / maxVolume * 22} width={Math.max(1, Math.min(4, plotWidth / Math.max(1, prices.length) * .65))} height={activityValue(p)! / maxVolume * 22} fill={p.open===undefined?'var(--price-flat,#b8cfe1)':p.close>p.open?'var(--price-up,#55dfbb)':p.close<p.open?'var(--price-down,#ff8ea1)':'var(--price-flat,#b8cfe1)'} />)}
        {prices.length > 0 && prices.every(p => activityValue(p) === null) && <text x={left + 8} y={volumeBottom-6}>{activity==='turnover'?text('Turnover unavailable','成交额暂无数据'):text("Volume not recorded", "未记录成交量")}</text>}
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
        {showKdj&&<g data-kdj-panel>
          <text x={0} y={macdTop-6}>{text('KDJ','KDJ')}</text>
          {[0,20,80,100].map(value=><g key={value}><line x1={left} x2={right} y1={kdjY(value)} y2={kdjY(value)} stroke="var(--ui-line,#30485a)" strokeDasharray="2 3"/><text x={left-7} y={kdjY(value)+4} textAnchor="end">{value}</text></g>)}
          {(['k','d','j'] as const).map((line,index)=><path key={line} data-kdj-line={line} d={indicatorPath(kdj.map(point=>({date:point.date,value:point[line]})),kdjY)} fill="none" stroke={MA_COLORS[index]} strokeWidth={1.5} pointerEvents="none"/>)}
          {!kdj.length&&<text x={left+8} y={kdjY(50)-8}>{text('Insufficient OHLC history','开高低收历史数据不足')}</text>}
        </g>}
        {showBoll&&<g data-boll-panel data-panel-top={macdTop} data-panel-bottom={macdBottom}>
          <text x={0} y={macdTop-6}>{text('BOLL','BOLL')}</text>
          {[bollLow,(bollLow+bollHigh)/2,bollHigh].map(value=><g key={value}><line x1={left} x2={right} y1={bollY(value)} y2={bollY(value)} stroke="var(--ui-line,#30485a)" strokeDasharray="2 3"/><text x={left-7} y={bollY(value)+4} textAnchor="end">{new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(value)}</text></g>)}
          {useCandles?candles.map(price=>{const color=price.close>price.open?'var(--price-up,#55dfbb)':price.close<price.open?'var(--price-down,#ff8ea1)':'var(--price-flat,#b8cfe1)';return <g key={price.date} data-boll-candle={price.date} pointerEvents="none"><line x1={x(price.date)} x2={x(price.date)} y1={bollY(price.high)} y2={bollY(price.low)} stroke={color}/><rect x={x(price.date)-candleWidth/2} y={Math.min(bollY(price.open),bollY(price.close))} width={candleWidth} height={Math.max(.5,Math.abs(bollY(price.open)-bollY(price.close)))} fill={color}/></g>}):<path data-boll-close d={indicatorPath(prices.map(price=>({date:price.date,value:price.close})),bollY)} fill="none" stroke="var(--chart-line,#79cfe9)" strokeWidth={1} pointerEvents="none"/>}
          {(['upper','middle','lower'] as const).map((band,index)=><path key={band} data-boll-band={band} d={indicatorPath(boll.map(point=>({date:point.date,value:point[band]})),bollY)} fill="none" stroke={MA_COLORS[index]} strokeWidth={1.5} pointerEvents="none"/>)}
          {!boll.length&&<text x={left+8} y={macdTop+12}>{text('Insufficient history','历史数据不足')}</text>}
        </g>}
        {tickDates.map(date => <text key={date} data-session-tick={date} x={x(date)} y={chartHeight-6} textAnchor="middle">{formatTickDate(date)}</text>)}
        {useCandles&&groups.map(group=>{
          const candle=candles.find(price=>price.date===barDate(group.events[0].date));if(!candle)return null;
          const above=group.y<y(candle.high),below=group.y>y(candle.low);if(!above&&!below)return null;
          return <line key={group.events[0].id} data-event-connector={group.events[0].date} x1={left+group.x} x2={left+group.x} y1={group.y+(above?group.size/2:-group.size/2)} y2={y(above?candle.high:candle.low)} stroke="var(--ui-muted,#9db4c8)" strokeDasharray="2 3" opacity={.35} pointerEvents="none"/>;
        })}
        {activeDate && <line x1={priceDate && nearest ? x(nearest.date) : x(activeDate)} x2={priceDate && nearest ? x(nearest.date) : x(activeDate)} y1={8} y2={volumeBottom+2} stroke="var(--ui-muted,#c4e8f4)" opacity={.55} pointerEvents="none"/>}
        {priceDate && nearest && <circle cx={x(nearest.date)} cy={y(nearest.close)} r={4} fill="var(--chart-line,#79cfe9)" stroke="#e5f7ff" strokeWidth={2} pointerEvents="none"/>}
      </svg>
      {priceDate && nearest && <div className={styles.priceTooltip} role="group" aria-label={text("Price details", "股价详情")} data-price-details data-price-mode={hoverOnly?'hover':'pinned'} style={{right:8,top:4,transform:'none'}}>
        <div className={styles.priceDetailsHeader}><span>{aggregated&&nearest.periodStart?`${nearest.periodStart} – ${nearest.date}`:nearest.date}</span>{!hoverOnly&&<button type="button" aria-label={text("Close price details", "关闭股价详情")} onClick={()=>closePriceDetails(true)}>×</button>}</div>
        {useCandles&&nearest.open!==undefined&&nearest.high!==undefined&&nearest.low!==undefined&&<span data-hover-ohlc>{text('O','开')} {nearest.open.toFixed(2)} · {text('H','高')} {nearest.high.toFixed(2)} · {text('L','低')} {nearest.low.toFixed(2)}</span>}
        <strong>{text("Close", "收盘价")} · {new Intl.NumberFormat(locale, data?.currency ? {style:"currency",currency:data.currency,minimumFractionDigits:2,maximumFractionDigits:2} : {minimumFractionDigits:2,maximumFractionDigits:2}).format(nearest.close)}</strong>
        {hoverReturn&&<span title={`${hoverReturn.baselineDate} → ${hoverReturn.latestDate}`}>{hoverReturn.adjacent?periodChangeLabel:`${text('Change since','较')} ${hoverReturn.baselineDate}`} · <b data-daily-return data-return-direction={hoverReturn.change>0?'up':hoverReturn.change<0?'down':'flat'}>{hoverReturn.change>0?'▲':hoverReturn.change<0?'▼':'—'} {signedPercent(hoverReturn.change)}</b></span>}
        {toLatest!==undefined&&latest&&<span title={`${nearest.date} → ${latest.date}`} data-latest-return>{text('Change to latest close','至最新收盘涨跌幅')} ({formatDate(latest.date)}) · <b data-return-direction={toLatest>0?'up':toLatest<0?'down':'flat'}>{toLatest>0?'▲':toLatest<0?'▼':'—'} {signedPercent(toLatest)}</b></span>}
        <span>{text("Volume", "成交量")} · {nearest.volume === null ? text("Not recorded", "未记录") : new Intl.NumberFormat(locale).format(nearest.volume)}</span>
        {(activity==='turnover'||nearest.amount!==undefined)&&<span>{text('Turnover','成交额')} · {nearest.amount===undefined?text('Not recorded','暂无数据'):new Intl.NumberFormat(locale,data?.currency?{style:'currency',currency:data.currency,maximumFractionDigits:0}:{}).format(nearest.amount)}</span>}
        <div className={styles.maValues}>{movingAverages.map((points,index)=>{const point=points.find(point=>point.date===nearest.date);return averages.includes(averagePeriods[index])&&<span key={averagePeriods[index]} style={{color:MA_COLORS[index]}}>{text('MA','MA')}{averagePeriods[index]} · {point?.value.toFixed(2)??text('Insufficient history','历史数据不足')}</span>;})}</div>
        {showMacd&&<span>{text('MACD','MACD')} · {(()=>{const point=macd.find(point=>point.date===nearest.date);return point?`DIF ${point.dif.toFixed(2)} · DEA ${point.signal.toFixed(2)} · ${text('Histogram','柱值')} ${point.histogram.toFixed(2)}`:text('Insufficient history','历史数据不足');})()}</span>}
        {showKdj&&<span>{text('KDJ','KDJ')} · {(()=>{const point=kdj.find(point=>point.date===nearest.date);return point?`K ${point.k.toFixed(2)} · D ${point.d.toFixed(2)} · J ${point.j.toFixed(2)}`:text('Insufficient OHLC history','开高低收历史数据不足');})()}</span>}
        {showBoll&&<span>{text('BOLL','BOLL')} · {(()=>{const point=boll.find(point=>point.date===nearest.date);return point?`${text('Upper','上轨')} ${point.upper.toFixed(2)} · ${text('Middle','中轨')} ${point.middle.toFixed(2)} · ${text('Lower','下轨')} ${point.lower.toFixed(2)}`:text('Insufficient history','历史数据不足');})()}</span>}
        {showMacd&&(()=>{const point=macd.find(point=>point.date===nearest.date);return point?<span>{text('MACD','MACD')} · {text('DIF','DIF')} {point.dif.toFixed(2)} · {text('DEA','DEA')} {point.signal.toFixed(2)} · {text('Hist','柱值')} {point.histogram.toFixed(2)}</span>:null;})()}
      </div>}
      {groups.map(group=>{const presentations=[...new Map(group.events.map(event=>{const p=eventPresentation(event,chinese);return [p.symbol+p.color,p] as const;})).values()],style=presentations[0],multiple=group.events.length>1;return <button key={group.events[0].id} className={styles.marker} data-event-type={presentations.length>1?'multiple':style.type} data-marker-size={group.size} data-event-count={group.events.length} type="button" style={{left:left+group.x,top:group.y,width:group.size,height:group.size,color:categoryColor(style.color),borderColor:categoryColor(style.color)}} title={group.events.map(e=>`${eventPresentation(e,chinese).label} · ${formatDate(e.date)}: ${e.title}`).join('; ')} aria-label={multiple?`${group.events.length} ${text('events','个事件')} · ${presentations.map(p=>p.label).join(' / ')} · ${formatDate(group.events[0].date)}`:`${formatDate(group.events[0].date)}: ${group.events[0].title}`} aria-pressed={group.events.some(e=>e.id===clusterId||e.id===selectedId)} onClick={e=>{if(multiple){setSelectedId('');onDismissEvent?.();setPriceSelection(null);chooserTrigger.current=e.currentTarget;setClusterAnchor(eventWindowAnchor(e));setClusterId(group.events[0].id);}else selectEvent(group.events[0].id,e);}} onPointerEnter={()=>{setHoverDate(group.events[0].date);}} onFocus={()=>{setPriceSelection(null);setHoverDate(group.events[0].date);}} onBlur={()=>{setHoverDate(null);}}><span className={styles.markerSymbols} data-mixed={presentations.length>1||undefined}>{presentations.slice(0,3).map(p=><span key={p.symbol+p.color} style={{color:categoryColor(p.color)}}>{p.symbol}</span>)}</span>{multiple&&<span className={styles.countBadge} aria-hidden="true">{group.events.length}</span>}</button>;})}
      {openCluster&&<FloatingEventWindow role="group" focusClose anchor={clusterAnchor} title={text('Choose an event','选择事件')} closeLabel={text('Close event list','关闭事件列表')} onClose={closeChooser}>
        <p>{openCluster.events.length} {text('events','个事件')} · {formatDate(openCluster.events[0].date)}</p>
        <div className={styles.eventList}>{openCluster.events.map(event=>{const style=eventPresentation(event,chinese);return <button key={event.id} type="button" onClick={click=>selectEvent(event.id,click)}><span style={{color:categoryColor(style.color)}}>{style.symbol} {style.label}</span> · {formatDate(event.date)} · {event.title}{returnFor(event.id)&&returnLabel(returnFor(event.id)!,event)}</button>;})}</div>
      </FloatingEventWindow>}
    </div>
    <p className={styles.coverage}>{chartMode==='candles'&&prices.length>0&&!useCandles&&<span>{text("OHLC unavailable; showing closes","暂无完整开高低收数据，显示收盘价")} · </span>}{activeDate && nearest ? `${formatDate(activeDate)} · ${text("Nearest stored close", "最近的已存储收盘价")} ${nearest.close.toFixed(2)} (${formatDate(nearest.date)}) · ${text("Volume", "成交量")} ${nearest.volume === null ? "—" : new Intl.NumberFormat(locale, { notation: "compact" }).format(nearest.volume)}` : prices.length ? `${prices.length} ${barsLabel} · ${formatDate(prices[0].date)} – ${formatDate(prices.at(-1)!.date)} · ${text("Close may be provider-adjusted", "收盘价可能为供应商复权价")}` : text("Events use source publication dates; missing prices are not filled.", "事件以资料发布日期排列；缺失股价不会填补。")}</p>
    {data && !data.available && <button type="button" className={styles.retry} onClick={() => setRetry(value => value + 1)}>{text("Retry prices", "重试读取股价")}</button>}
    {selected && !onSelectEvent && <FloatingEventWindow key={selected.id} anchor={eventAnchor} title={text('Event details','事件详情')} onClose={()=>{setSelectedId('');setHoverDate(null);}}>
      <strong>{eventPresentation(selected,chinese).symbol} {eventPresentation(selected,chinese).label}</strong><h2>{selected.title}</h2><p>{text('Published','发布于')} · {selected.date}</p>
      {selectedGroup && selectedGroup.events.length > 1 && <div className={styles.eventList}>{selectedGroup.events.map(event => <button key={event.id} type="button" aria-pressed={event.id === selected.id} onClick={click=>selectEvent(event.id,click)}>{formatDate(event.date)} · {event.title}</button>)}</div>}
      <p>{selected.description}</p>{selected.planned && <p>{text('Announced / planned; completion is not established.','已宣布／计划中；尚不代表已完成。')}</p>}{returnFor(selected.id)&&returnLabel(returnFor(selected.id)!,selected)}<nav><a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{selected.sourceTitle} ↗</a></nav>
    </FloatingEventWindow>}
  </section>;
}

export function CompanyResearchTimeline({ company, graph, initialPrices }: { company: GraphNode; graph?: KnowledgeGraph; initialPrices?: TimelinePrices }) {
  const [history, setHistory] = useState({ companyId: company.id, available: Boolean(initialPrices?.companyId === company.id && initialPrices.prices.length) });
  const onPriceHistoryChange = useCallback((available: boolean) => setHistory({ companyId: company.id, available }), [company.id]);
  return <div className={styles.pageResearch} hidden={history.companyId !== company.id || !history.available}><CompanySnapshot company={company} profileLink={false} showHeading={false} /><CompanyTimeline companyId={company.id} graph={graph} initialPrices={initialPrices} onPriceHistoryChange={onPriceHistoryChange} /></div>;
}
