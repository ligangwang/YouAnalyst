import type { BusinessEvent } from "../knowledge-graph/business-events";
import { intelligenceEventTitle, type IntelligenceEvent, type IntelligenceSource } from "../intelligence/model";
import { relationshipSourceTitle, relationshipSummary, type KnowledgeGraph } from "../knowledge-graph/model";
import {classifyEvent,eventPresentation,type ClassifiedEvent} from '../events/classification';

export const TIMELINE_RANGES = [30, 90, 180, 'ytd', 365, 1826] as const;
export const TIMELINE_RANGE_LABELS = {30:'1M',90:'3M',180:'6M',ytd:'YTD',365:'1Y',1826:'5Y'} as const;
export const DEFAULT_TIMELINE_RANGE = 30;
export type TimelineRange = (typeof TIMELINE_RANGES)[number];
export const TIMELINE_INTERVALS = ['daily','weekly','monthly','quarterly','yearly'] as const;
export type TimelineInterval = (typeof TIMELINE_INTERVALS)[number];
export type TimelineIntervalChoice = 'auto' | TimelineInterval;
export function resolvedTimelineInterval(range:TimelineRange,choice:TimelineIntervalChoice='auto'):TimelineInterval {
 return choice==='auto'?(range===1826?'weekly':'daily'):choice;
}
export type TimelinePrice = { date: string; close: number; volume: number | null; amount?:number; open?:number; high?:number; low?:number; periodStart?:string };
export type TimelineEvent = ClassifiedEvent & { id: string; date: string; publishedAt?: string | null; title: string; description: string; lane: "business" | "research"; category?: "business" | "filing" | "research"; sourceUrl: string; sourceTitle: string; planned: boolean };
export type TimelinePrices = { companyId: string; start: string; end: string; currency: string | null; prices: TimelinePrice[]; warmupPrices?:TimelinePrice[]; interval?:TimelineInterval; available: boolean };
export function timelineWeek(date:string) {
 const day=new Date(`${date}T00:00:00Z`);day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);
}
export function timelinePeriod(date:string,interval:TimelineInterval){
 if(interval==='weekly')return timelineWeek(date);
 if(interval==='monthly')return date.slice(0,7)+'-01';
 if(interval==='quarterly')return `${date.slice(0,4)}-${String(Math.floor((Number(date.slice(5,7))-1)/3)*3+1).padStart(2,'0')}-01`;
 if(interval==='yearly')return date.slice(0,4)+'-01-01';
 return date;
}
export function timelinePeriodEnd(date:string,interval:TimelineInterval){
 if(interval==='daily')return date;
 const end=new Date(`${timelinePeriod(date,interval)}T00:00:00Z`);
 if(interval==='weekly')end.setUTCDate(end.getUTCDate()+6);
 else{if(interval==='yearly')end.setUTCFullYear(end.getUTCFullYear()+1);else end.setUTCMonth(end.getUTCMonth()+(interval==='monthly'?1:3));end.setUTCDate(0);}
 return end.toISOString().slice(0,10);
}
export function adjacentTimelineBars(previous:string,current:string,choice:TimelineInterval|boolean){
 const interval=typeof choice==='boolean'?(choice?'weekly':'daily'):choice;
 if(interval==='weekly')return Date.parse(timelineWeek(current))-Date.parse(timelineWeek(previous))===7*86_400_000;
 if(interval!=='daily'){
  const index=(date:string)=>Number(date.slice(0,4))*12+Number(date.slice(5,7))-1;
  return index(timelinePeriod(current,interval))-index(timelinePeriod(previous,interval))===(interval==='monthly'?1:interval==='quarterly'?3:12);
 }
 const gap=(Date.parse(current)-Date.parse(previous))/86_400_000;
 return gap===1||(gap===3&&new Date(previous).getUTCDay()===5&&new Date(current).getUTCDay()===1);
}
/** Monday-based trading weeks: missing OHLC/volume stays missing, never inferred. */
export function weeklyTimelinePrices(prices:TimelinePrice[]):TimelinePrice[] {
 return aggregateTimelinePrices(prices,'weekly');
}
/** Calendar periods use first open, highest high, lowest low, last close and sums. */
export function aggregateTimelinePrices(prices:TimelinePrice[],interval:TimelineInterval):TimelinePrice[] {
 if(interval==='daily')return [...prices].sort((a,b)=>a.date.localeCompare(b.date));
 const periods=new Map<string,TimelinePrice[]>();
 for(const price of [...prices].sort((a,b)=>a.date.localeCompare(b.date))){const key=timelinePeriod(price.date,interval);const rows=periods.get(key)??[];rows.push(price);periods.set(key,rows);}
 return [...periods.values()].map(rows=>{
  const first=rows[0],last=rows.at(-1)!;
  const complete=rows.every(row=>row.open!==undefined&&row.high!==undefined&&row.low!==undefined);
  return {date:last.date,periodStart:first.date,close:last.close,volume:rows.every(row=>row.volume!==null)?rows.reduce((sum,row)=>sum+row.volume!,0):null,
   ...(rows.every(row=>row.amount!==undefined)?{amount:rows.reduce((sum,row)=>sum+row.amount!,0)}:{}),
   ...(complete?{open:first.open,high:Math.max(...rows.map(row=>row.high!)),low:Math.min(...rows.map(row=>row.low!))}:{})};
 });
}
/** Keep the first visible partial period stable when indicator warmup is requested. */
export function timelinePriceBars(prices:TimelinePrice[],start:string,choice:TimelineInterval|boolean){
 const interval=typeof choice==='boolean'?(choice?'weekly':'daily'):choice;
 const visible=prices.filter(price=>price.date>=start);
 const preceding=prices.filter(price=>price.date<start&&(interval==='daily'||timelinePeriod(price.date,interval)<timelinePeriod(start,interval)));
 return {prices:aggregateTimelinePrices(visible,interval),warmupPrices:aggregateTimelinePrices(preceding,interval)};
}
export function timelineIndicatorHistoryStart(start:string,interval:TimelineInterval,period:number){
 const [minimum,perBar]={daily:[180,2],weekly:[540,10],monthly:[1800,35],quarterly:[5400,100],yearly:[21900,370]}[interval];
 return new Date(Date.parse(start)-Math.max(minimum,period*perBar)*86_400_000).toISOString().slice(0,10);
}
/** Stored sessions have equal spacing; closure publications keep distinct, interpolated dates. */
export function tradingSessionAxis(dates: string[], start: string, end: string) {
  const sessions = [...new Set(dates.filter(date => date >= start && date <= end))].sort();
  const calendarRatio = (date: string) => (Date.parse(date) - Date.parse(start)) / Math.max(1, Date.parse(end) - Date.parse(start));
  const anchors = sessions.map((date, index) => ({ date, position: (index + .5) / sessions.length }));
  if (sessions.length && start < sessions[0]) anchors.unshift({ date: start, position: 0 });
  if (sessions.length && end > sessions.at(-1)!) anchors.push({ date: end, position: 1 });
  const ratio = (date: string) => {
    if (!sessions.length) return calendarRatio(date);
    if (date <= anchors[0].date) return anchors[0].position;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (date <= b.date) return a.position + (Date.parse(date) - Date.parse(a.date)) / Math.max(1, Date.parse(b.date) - Date.parse(a.date)) * (b.position - a.position);
    }
    return anchors.at(-1)!.position;
  };
  const dateAt = (position: number) => sessions.length
    ? sessions[Math.max(0, Math.min(sessions.length - 1, Math.round(position * sessions.length - .5)))]
    : new Date(Date.parse(start) + Math.max(0, Math.min(1, position)) * (Date.parse(end) - Date.parse(start))).toISOString().slice(0, 10);
  return { sessions, ratio, dateAt };
}
export function timelineDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) return null;
  const date = value.slice(0, 10);
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}
export function timelineWindow(days: TimelineRange, end = new Date().toISOString().slice(0, 10)) {
  if (!timelineDate(end)) throw new Error("Invalid timeline end date");
  if(days==='ytd')return {start:`${end.slice(0,4)}-01-01`,end};
  if(days===365||days===1826){const date=new Date(`${end}T00:00:00Z`),month=date.getUTCMonth();date.setUTCFullYear(date.getUTCFullYear()-(days===365?1:5));if(date.getUTCMonth()!==month)date.setUTCDate(0);return {start:date.toISOString().slice(0,10),end};}
  return { start: new Date(Date.parse(`${end}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10), end };
}
export type TimelineSplit = { effectiveDate: string; numerator: number; denominator: number };
/** Use only completed splits for this listing, through the chart's adjustment date. */
export function timelineSplits(records:Record<string,unknown>[],ticker:string,market:string,asOf:string):TimelineSplit[] {
  const byDate=new Map<string,TimelineSplit>();
  for(const record of records){
    if(record.ticker!==ticker||record.market!==market||record.type!=='split'||record.status!=='completed')continue;
    const effectiveDate=timelineDate(record.effectiveDate);
    const numerator=record.splitNumerator,denominator=record.splitDenominator;
    if(!effectiveDate||record.effectiveDate!==effectiveDate||typeof numerator!=='number'||!Number.isFinite(numerator)||numerator<=0
      ||typeof denominator!=='number'||!Number.isFinite(denominator)||denominator<=0||!Number.isFinite(numerator/denominator)||numerator/denominator<=0){
      throw new Error('Invalid completed split');
    }
    if(effectiveDate>asOf)continue;
    const previous=byDate.get(effectiveDate);
    if(previous&&previous.numerator/previous.denominator!==numerator/denominator)throw new Error('Conflicting completed splits');
    byDate.set(effectiveDate,{effectiveDate,numerator,denominator});
  }
  return [...byDate.values()].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
}
export function mapTimelinePrice(data: Record<string, unknown>, ticker: string, market: string, splits:readonly TimelineSplit[]=[]): TimelinePrice | null {
  const date = timelineDate(data.tradingDate);
  if (data.ticker !== ticker || data.market !== market || !date || typeof data.close !== "number" || !Number.isFinite(data.close) || data.close <= 0) return null;
  const rawClose=typeof data.rawClose==='number'&&Number.isFinite(data.rawClose)&&data.rawClose>0?data.rawClose:data.close;
  const values=[data.open,data.high,data.low];
  const valid=values.every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0)
    && Number(data.high)>=Math.max(Number(data.open),Number(data.low),rawClose)
    && Number(data.low)<=Math.min(Number(data.open),rawClose)
    && !((data.source==='eodhd-bulk-eod'||data.source==='eodhd-eod')&&!(typeof data.rawClose==='number'&&Number.isFinite(data.rawClose)&&data.rawClose>0));
  // Explicit rawClose prevents dividing an already adjusted legacy close twice.
  // A split applies only to sessions before its first split-adjusted session.
  const splitBasis=splits.length>0&&typeof data.rawClose==='number'&&Number.isFinite(data.rawClose)&&data.rawClose>0;
  const factor=splits.filter(split=>date<split.effectiveDate).reduce((product,split)=>product*(split.numerator/split.denominator),1);
  if(!Number.isFinite(factor)||factor<=0)throw new Error('Invalid cumulative split factor');
  const close=splitBasis?rawClose/factor:data.close;
  if(!Number.isFinite(close)||close<=0)throw new Error('Invalid split-adjusted close');
  // Listings without stored splits retain their existing close basis.
  const scale=close/rawClose;
  // EODHD volume is already split-adjusted; amount is monetary and unchanged.
  return { date, close, ...(valid&&values.every(value=>Number.isFinite(Number(value)*scale))?{open:Number(data.open)*scale,high:Number(data.high)*scale,low:Number(data.low)*scale}:{}), ...(typeof data.amount==='number'&&Number.isFinite(data.amount)&&data.amount>=0?{amount:data.amount}:{}), volume: typeof data.volume === "number" && Number.isFinite(data.volume) && data.volume >= 0 ? data.volume : null };
}
// Publication dates anchor the chart. Reviews and collection timestamps never become disclosure dates.
export function companyTimelineEvents(companyId: string, graph: KnowledgeGraph | null, business: BusinessEvent[], chinese = false): TimelineEvent[] {
  const result: TimelineEvent[] = business.filter(e => e.companyIds.includes(companyId)).flatMap(e => {
    const date = timelineDate(e.sourceDate);
    return date && /^https:\/\//.test(e.sourceUrl) ? [{ id: e.id, date, title: chinese ? e.titleZh : e.title, description: chinese ? e.summaryZh : e.summary, lane: "business" as const, sourceUrl: e.sourceUrl, sourceTitle: e.sourceTitle, planned: e.planned }] : [];
  });
  for (const edge of graph?.relationships ?? []) {
    if (edge.type === "PARTICIPATES_IN" || (edge.source !== companyId && edge.target !== companyId)) continue;
    const facts = edge.facts?.length ? edge.facts : [{ scope: edge.summary, state: edge.commercialStatus, sourceIds: edge.sourceIds }];
    facts.forEach((fact, index) => {
      for (const source of graph!.sources.filter(s => fact.sourceIds.includes(s.id))) {
        const date = timelineDate(source.sourceDate);
        if (!date || !/^https:\/\//.test(source.url)) continue;
        const locale = chinese ? "zh-CN" : "en";
        const title = relationshipSourceTitle(source, locale);
        result.push({ id: `${edge.id}:${fact.id ?? index}:${source.id}`, date, title, description: relationshipSummary({ summary: fact.scope, summaryZh: edge.summaryZh }, locale), lane: "research", sourceUrl: source.url, sourceTitle: title, planned: fact.state === "ANNOUNCED" });
      }
    });
  }
  const unique = new Map<string, TimelineEvent>();
  for (const event of result) {
    const key = `${event.date}:${event.sourceUrl}`;
    const existing = unique.get(key);
    if (!existing || event.lane === "business") unique.set(key, event);
  }
  return [...unique.values()].map(event=>{const classification=classifyEvent({title:event.title,type:event.lane==='business'?'company_news':'research'});return {...event,...classification,...(event.lane==='research'&&classification.eventType==='other'?{eventType:'relationship' as const,eventSubtype:'relationship_disclosure'}:{})};}).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
/** Only same-date events with the same symbol share a badge; all other dates retain their anchors. */
export function layoutTimelineMarkers(events:TimelineEvent[],start:string,end:string,width:number,spacing=36,position?: (date:string)=>number,groupDate:(date:string)=>string=date=>date){
 const groups:{x:number;level:number;events:TimelineEvent[]}[]=[];
 const last:typeof groups=[];
 const span=Math.max(1,Date.parse(end)-Date.parse(start));
 for(const event of events.filter(event=>event.date>=start&&event.date<=end).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){
  const x=position?position(event.date):(Date.parse(event.date)-Date.parse(start))/span*width;
  const presentation=eventPresentation(event);
  const matching=groups.findLast(group=>{
   const previous=eventPresentation(group.events[0]);
   return groupDate(group.events[0].date)===groupDate(event.date)&&previous.type===presentation.type&&previous.symbol===presentation.symbol&&previous.color===presentation.color;
  });
  if(matching){matching.events.push(event);continue;}
  const freeLevel=last.findIndex(group=>x-group.x>=spacing);
  const level=freeLevel===-1?last.length:freeLevel;
  const group={x,level,events:[event]};groups.push(group);last[level]=group;
 }
 return groups;
}
/** Place date-anchored markers in a fixed price plot, using the chooser for crowded dates. */
export function layoutOverlayMarkers(events:TimelineEvent[],start:string,end:string,width:number,top:number,bottom:number,curve:{x:number;y:number}[],preferredSize=28,position?: (date:string)=>number,candleBounds:{left:number;right:number;top:number;bottom:number}[]=[],groupDate:(date:string)=>string=date=>date){
 const rows=4,gap=8,padding=4;
 let groups=layoutTimelineMarkers(events,start,end,width,36,position,groupDate).map(group=>({...group,events:[...group.events]}));
 // Consolidate only a crowded date, never neighboring publication dates.
 for(;;){
  const dense=groups.findIndex((group,index)=>index>=rows&&group.x-groups[index-rows].x<22);
  if(dense<0)break;
  const window=groups.slice(dense-rows,dense+1);
  const date=window.map(group=>groupDate(group.events[0].date)).sort((a,b)=>groups.filter(g=>groupDate(g.events[0].date)===b).length-groups.filter(g=>groupDate(g.events[0].date)===a).length).find(date=>groups.filter(g=>groupDate(g.events[0].date)===date).length>1);
  if(!date)break;
  const matching=groups.filter(group=>groupDate(group.events[0].date)===date),first=matching[0];
  groups=groups.filter(group=>groupDate(group.events[0].date)!==date);
  groups.push({...first,events:matching.flatMap(group=>group.events)});
  groups.sort((a,b)=>a.x-b.x||a.events[0].id.localeCompare(b.events[0].id));
 }
 const span=Math.min(Infinity,...groups.slice(rows).map((group,index)=>group.x-groups[index].x));
 const size=Math.max(4,Math.min(preferredSize,(bottom-top)/rows-6,span-gap));
 const ys=Array.from({length:rows},(_,row)=>top+size/2+padding+row*(bottom-top-size-2*padding)/(rows-1));
 const distance=(x:number,y:number)=>{
  let nearest=Infinity;
  for(let i=0;i<curve.length;i++){
   const a=curve[i],b=curve[i+1]??a,dx=b.x-a.x,dy=b.y-a.y;
   const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
   nearest=Math.min(nearest,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
  }
  for(const candle of candleBounds){
   const dx=Math.max(candle.left-x,0,x-candle.right),dy=Math.max(candle.top-y,0,y-candle.bottom);
   nearest=Math.min(nearest,Math.hypot(dx,dy));
  }
  return nearest;
 };
 const placed: Array<(typeof groups)[number]&{y:number;size:number}> = [];
 for(const group of groups){
  let chosen:{y:number;clearance:number}|undefined,markerSize=size;
  for(;markerSize>=4;markerSize=Math.max(4,markerSize-2)){
   const minY=top+markerSize/2+padding,maxY=bottom-markerSize/2-padding;
   const candidates=[minY,maxY,...Array.from({length:Math.max(0,Math.floor((maxY-minY)/2))},(_,i)=>minY+i*2)]
    .filter(y=>placed.every(previous=>Math.hypot(group.x-previous.x,y-previous.y)>=(markerSize+previous.size)/2+2))
    .map(y=>({y,clearance:distance(group.x,y)})).sort((a,b)=>b.clearance-a.clearance||a.y-b.y);
   chosen=candidates.find(candidate=>candidate.clearance>=markerSize/2+8);
   if(chosen)break;
   if(markerSize===4){
    // If one date is crowded, retain its symbols/references in the same-date chooser.
    const sameDate=placed.find(previous=>groupDate(previous.events[0].date)===groupDate(group.events[0].date));
    if(sameDate){sameDate.events.push(...group.events);break;}
    chosen=candidates[0]??{y:minY,clearance:distance(group.x,minY)};break;
   }
  }
  if(!chosen)continue;
  placed.push({...group,level:ys.reduce((best,y,i)=>Math.abs(y-chosen!.y)<Math.abs(ys[best]-chosen!.y)?i:best,0),y:chosen.y,size:markerSize});
 }
 return placed;
}
export function clusterTimelineEvents(events: TimelineEvent[], start: string, end: string, width: number, spacing = 36, separateLanes = true) {
  const first = Date.parse(start), span = Math.max(1, Date.parse(end) - first);
  const groups: { lane: TimelineEvent["lane"]; x: number; events: TimelineEvent[] }[] = [];
  for (const event of events.filter(e => e.date >= start && e.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const x = (Date.parse(event.date) - first) / span * width;
    const previous = (separateLanes ? groups.filter(g => g.lane === event.lane) : groups).at(-1);
    // Bound cluster width from its anchor, so a dense run cannot swallow an entire range.
    if (previous && x - previous.x < spacing) previous.events.push(event);
    else groups.push({ lane: event.lane, x, events: [event] });
  }
  return groups;
}

// Keep grouped feed events grouped; references retain their own source links in the company card.
export function intelligenceTimelineEvents(companyId: string, events: IntelligenceEvent[], chinese = false, sourceFilter: IntelligenceSource | "" = ""): TimelineEvent[] {
  return events.filter(event => event.companyIds.includes(companyId)).flatMap(event => {
    const date = timelineDate(event.publication_date);
    const source = event.evidence.find(source => (!sourceFilter || source.channel === sourceFilter) && /^https:\/\//.test(source.url));
    if (!date || !source) return [];
    const title = intelligenceEventTitle(event, chinese ? "zh-CN" : "en");
    return [{ eventType:event.eventType,eventSubtype:event.eventSubtype,id: event.id, date, publishedAt: event.published_at, title, description: event.summary === "交易所上市公司原始公告。" && !chinese ? "Original announcement from an exchange-listed company." : event.summary, lane: event.category === "BUSINESS" ? "business" as const : "research" as const, category: event.category === "BUSINESS" ? "business" as const : event.category === "FILING" ? "filing" as const : "research" as const, sourceUrl: source.url, sourceTitle: title, planned: event.planned }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
