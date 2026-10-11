import type { BusinessEvent } from "./knowledge-graph/business-events";
import { intelligenceEventTitle, type IntelligenceEvent, type IntelligenceSource } from "./intelligence/model";
import { relationshipSourceTitle, relationshipSummary, type KnowledgeGraph } from "./knowledge-graph/model";

export const TIMELINE_RANGES = [30, 90, 180, 365, 1826] as const;
export const DEFAULT_TIMELINE_RANGE = 30;
export type TimelineRange = (typeof TIMELINE_RANGES)[number];
export type TimelinePrice = { date: string; close: number; volume: number | null };
export type TimelineEvent = { id: string; date: string; title: string; description: string; lane: "business" | "research"; category?: "business" | "filing" | "research"; sourceUrl: string; sourceTitle: string; planned: boolean };
export type TimelinePrices = { companyId: string; start: string; end: string; currency: string | null; prices: TimelinePrice[]; available: boolean };
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
  return { date, close: data.close, volume: typeof data.volume === "number" && Number.isFinite(data.volume) && data.volume >= 0 ? data.volume : null };
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
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
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
    return [{ id: event.id, date, title, description: event.summary === "交易所上市公司原始公告。" && !chinese ? "Original announcement from an exchange-listed company." : event.summary, lane: event.category === "BUSINESS" ? "business" as const : "research" as const, category: event.category === "BUSINESS" ? "business" as const : event.category === "FILING" ? "filing" as const : "research" as const, sourceUrl: source.url, sourceTitle: title, planned: event.planned }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
