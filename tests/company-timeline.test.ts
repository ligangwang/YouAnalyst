import test from "node:test";
import assert from "node:assert/strict";
import { clusterTimelineEvents, companyTimelineEvents, intelligenceTimelineEvents, mapTimelinePrice, timelineDate, timelineWindow } from "../src/lib/company-timeline";
import type { IntelligenceEvent } from "../src/lib/intelligence/model";
import type { KnowledgeGraph } from "../src/lib/knowledge-graph/model";

const graph: KnowledgeGraph = { asOf: "2026-10-11", nodes: [], sources: [{ id: "s", title: "Primary disclosure", url: "https://example.com/disclosure", sourceDate: "2026-04-10" }], relationships: [{ id: "r", source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF", summary: "Evidence", commercialStatus: "ANNOUNCED", sourceIds: ["s"], publishedAt: "2026-09-20", researchReviewedAt: "2026-10-01", facts: [{ state: "ANNOUNCED", scope: "Planned partnership", sourceIds: ["s"], eventDate: "2027-01-01", reviewedAt: "2026-10-10" }] }] };
test("Explore timeline preserves grouped events, company/source filters and publication dates", () => {
  const event: IntelligenceEvent = { id: "release", origin: "US:AMD", companyIds: ["US:AMD"], edgeIds: [], category: "BUSINESS", title: "Original", titleEn: "English title", titleZh: "中文标题", summary: "Summary", published_at: null, publication_date: "2026-10-01", eventDate: "2027-01-01", planned: true, evidence: [{ id: "one", url: "https://example.com/one", title: "One", sourceDate: "2026-09-30", channel: "IR" }, { id: "two", url: "https://example.com/two", title: "Two", sourceDate: "2026-10-02", channel: "SEC" }] };
  const result = intelligenceTimelineEvents("US:AMD", [event]);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-10-01");
  assert.equal(result[0].title, "English title");
  assert.equal(result[0].category, "business");
  assert.equal(intelligenceTimelineEvents("US:AMD", [{ ...event, category: "FILING" }])[0].category, "filing");
  assert.equal(intelligenceTimelineEvents("US:AMD", [event], true)[0].title, "中文标题");
  assert.equal(intelligenceTimelineEvents("US:AMD", [event], false, "SEC")[0].sourceUrl, "https://example.com/two");
  assert.equal(intelligenceTimelineEvents("US:AMD", [event], false, "Exchange").length, 0);
  assert.equal(intelligenceTimelineEvents("US:NVDA", [event]).length, 0);
  assert.equal(intelligenceTimelineEvents("US:AMD", [{ ...event, publication_date: "" }]).length, 0);
});
test("timeline anchors disclosure to publication, never review or planned effective dates", () => {
  const events = companyTimelineEvents("US:AMD", graph, []);
  assert.equal(events.length, 1); assert.equal(events[0].date, "2026-04-10"); assert.equal(events[0].planned, true);
  assert.equal(companyTimelineEvents("US:META", graph, []).length, 0);
  assert.equal(companyTimelineEvents("US:AMD", { ...graph, sources: [{ ...graph.sources[0], sourceDate: null }] }, []).length, 0);
});
test("price history isolates markets and distinguishes missing volume from zero", () => {
  const row = { ticker: "AMD", market: "US", tradingDate: "2026-10-09", close: 120, volume: 0 };
  assert.equal(mapTimelinePrice(row, "AMD", "US")?.volume, 0);
  assert.equal(mapTimelinePrice({ ...row, volume: null }, "AMD", "US")?.volume, null);
  assert.equal(mapTimelinePrice(row, "AMD", "CN_A"), null);
  assert.equal(mapTimelinePrice({ ...row, close: NaN }, "AMD", "US"), null);
  assert.equal(timelineDate("2026-02-30"), null);
});
test("Chinese relationship events use localized source titles and summaries with English fallback", () => {
  const localized = { ...graph, sources: [{ ...graph.sources[0], titleZh: "原始公告" }], relationships: [{ ...graph.relationships[0], summaryZh: "计划合作" }] };
  const event = companyTimelineEvents("US:AMD", localized, [], true)[0];
  assert.equal(event.title, "原始公告"); assert.equal(event.sourceTitle, "原始公告"); assert.equal(event.description, "计划合作");
  assert.equal(companyTimelineEvents("US:AMD", graph, [], true)[0].description, "Planned partnership");
  assert.equal(companyTimelineEvents("US:AMD", localized, [])[0].title, "Primary disclosure");
});
test("clustering preserves lane and true date anchors, with bounded density", () => {
  const event = companyTimelineEvents("US:AMD", graph, [])[0];
  const events = [0, 1, 2, 3].map(i => ({ ...event, id: String(i), date: `2026-04-${10 + i}` }));
  const groups = clusterTimelineEvents(events, "2026-04-01", "2026-04-30", 290, 25);
  assert.equal(groups.length, 2); assert.equal(groups[0].events.length, 3); assert.equal(groups[0].events[0].date, "2026-04-10");
  assert.equal(clusterTimelineEvents([...events, { ...events[0], id: "business", lane: "business" }], "2026-04-01", "2026-04-30", 290, 25).length, 3);
  const overlay = clusterTimelineEvents([{ ...events[0], id: "business", lane: "business" }, ...events.toReversed()], "2026-04-01", "2026-04-30", 290, 25, false);
  assert.equal(overlay.length, 2); assert.equal(overlay[0].events.length, 4);
  assert.equal(overlay[0].events[0].date, "2026-04-10");
  assert.equal(timelineWindow(180, "2026-10-09").end, "2026-10-09");
});
