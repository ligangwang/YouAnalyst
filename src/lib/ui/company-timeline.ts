import type { BusinessEvent } from "../knowledge-graph/business-events";
import { intelligenceEventTitle, type IntelligenceEvent, type IntelligenceSource } from "../intelligence/model";
import { relationshipSourceTitle, relationshipSummary, type KnowledgeGraph } from "../knowledge-graph/model";
import {classifyEvent,eventPresentation,type ClassifiedEvent} from '../events/classification';

export const TIMELINE_RANGES = [30, 90, 180, 365, 1826] as const;
export const DEFAULT_TIMELINE_RANGE = 30;
export type TimelineRange = (typeof TIMELINE_RANGES)[number];
export type TimelinePrice = { date: string; close: number; volume: number | null; open?:number; high?:number; low?:number };
export type TimelineEvent = ClassifiedEvent & { id: string; date: string; title: string; description: string; lane: "business" | "research"; category?: "business" | "filing" | "research"; sourceUrl: string; sourceTitle: string; planned: boolean };
export type TimelinePrices = { companyId: string; start: string; end: string; currency: string | null; prices: TimelinePrice[]; available: boolean };
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
  return { start: new Date(Date.parse(`${end}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10), end };
}
export function mapTimelinePrice(data: Record<string, unknown>, ticker: string, market: string): TimelinePrice | null {
  const date = timelineDate(data.tradingDate);
  if (data.ticker !== ticker || data.market !== market || !date || typeof data.close !== "number" || !Number.isFinite(data.close) || data.close <= 0) return null;
  const rawClose=typeof data.rawClose==='number'&&Number.isFinite(data.rawClose)&&data.rawClose>0?data.rawClose:data.close;
  const values=[data.open,data.high,data.low];
  const valid=values.every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0)
    && Number(data.high)>=Math.max(Number(data.open),Number(data.low),rawClose)
    && Number(data.low)<=Math.min(Number(data.open),rawClose)
    && !((data.source==='eodhd-bulk-eod'||data.source==='eodhd-eod')&&!(typeof data.rawClose==='number'&&Number.isFinite(data.rawClose)&&data.rawClose>0));
  // Preserve the existing close series; scale raw OHLC to its provider-adjusted basis.
  const scale=data.close/rawClose;
  return { date, close: data.close, ...(valid&&values.every(value=>Number.isFinite(Number(value)*scale))?{open:Number(data.open)*scale,high:Number(data.high)*scale,low:Number(data.low)*scale}:{}), volume: typeof data.volume === "number" && Number.isFinite(data.volume) && data.volume >= 0 ? data.volume : null };
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
export function layoutTimelineMarkers(events:TimelineEvent[],start:string,end:string,width:number,spacing=36,position?: (date:string)=>number){
 const groups:{x:number;level:number;events:TimelineEvent[]}[]=[];
 const last:typeof groups=[];
 const span=Math.max(1,Date.parse(end)-Date.parse(start));
 for(const event of events.filter(event=>event.date>=start&&event.date<=end).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){
  const x=position?position(event.date):(Date.parse(event.date)-Date.parse(start))/span*width;
  const presentation=eventPresentation(event);
  const matching=groups.findLast(group=>{
   const previous=eventPresentation(group.events[0]);
   return group.events[0].date===event.date&&previous.type===presentation.type&&previous.symbol===presentation.symbol&&previous.color===presentation.color;
  });
  if(matching){matching.events.push(event);continue;}
  const freeLevel=last.findIndex(group=>x-group.x>=spacing);
  const level=freeLevel===-1?last.length:freeLevel;
  const group={x,level,events:[event]};groups.push(group);last[level]=group;
 }
 return groups;
}
/** Place date-anchored markers in a fixed price plot, using the chooser for crowded dates. */
export function layoutOverlayMarkers(events:TimelineEvent[],start:string,end:string,width:number,top:number,bottom:number,curve:{x:number;y:number}[],preferredSize=28,position?: (date:string)=>number){
 const rows=4,gap=8,padding=4;
 let groups=layoutTimelineMarkers(events,start,end,width,36,position).map(group=>({...group,events:[...group.events]}));
 // Consolidate only a crowded date, never neighboring publication dates.
 for(;;){
  const dense=groups.findIndex((group,index)=>index>=rows&&group.x-groups[index-rows].x<22);
  if(dense<0)break;
  const window=groups.slice(dense-rows,dense+1);
  const date=window.map(group=>group.events[0].date).sort((a,b)=>groups.filter(g=>g.events[0].date===b).length-groups.filter(g=>g.events[0].date===a).length).find(date=>groups.filter(g=>g.events[0].date===date).length>1);
  if(!date)break;
  const matching=groups.filter(group=>group.events[0].date===date),first=matching[0];
  groups=groups.filter(group=>group.events[0].date!==date);
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
  return nearest;
 };
 const last=Array<number>(rows).fill(-Infinity);
 return groups.map(group=>{
  const free=ys.map((y,row)=>({y,row,clearance:distance(group.x,y)})).filter(candidate=>group.x-last[candidate.row]>=size+gap-0.01);
  const candidates=free.length?free:ys.map((y,row)=>({y,row,clearance:group.x-last[row]}));
  candidates.sort((a,b)=>b.clearance-a.clearance||a.row-b.row);
  const chosen=candidates[0];last[chosen.row]=group.x;
  return {...group,level:chosen.row,y:chosen.y,size};
 });
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
    return [{ eventType:event.eventType,eventSubtype:event.eventSubtype,id: event.id, date, title, description: event.summary === "交易所上市公司原始公告。" && !chinese ? "Original announcement from an exchange-listed company." : event.summary, lane: event.category === "BUSINESS" ? "business" as const : "research" as const, category: event.category === "BUSINESS" ? "business" as const : event.category === "FILING" ? "filing" as const : "research" as const, sourceUrl: source.url, sourceTitle: title, planned: event.planned }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
