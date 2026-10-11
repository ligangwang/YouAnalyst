import test from "node:test";
import assert from "node:assert/strict";
import { clusterTimelineEvents, companyTimelineEvents, mapTimelinePrice, timelineDate, timelineWindow } from "../src/lib/company-timeline";
import type { KnowledgeGraph } from "../src/lib/knowledge-graph/model";

const graph: KnowledgeGraph = { asOf: "2026-10-11", nodes: [], sources: [{ id: "s", title: "Primary disclosure", url: "https://example.com/disclosure", sourceDate: "2026-04-10" }], relationships: [{ id: "r", source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF", summary: "Evidence", commercialStatus: "ANNOUNCED", sourceIds: ["s"], publishedAt: "2026-09-20", researchReviewedAt: "2026-10-01", facts: [{ state: "ANNOUNCED", scope: "Planned partnership", sourceIds: ["s"], eventDate: "2027-01-01", reviewedAt: "2026-10-10" }] }] };
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
test("clustering preserves lane and true date anchors, with bounded density", () => {
  const event = companyTimelineEvents("US:AMD", graph, [])[0];
  const events = [0, 1, 2, 3].map(i => ({ ...event, id: String(i), date: `2026-04-${10 + i}` }));
  const groups = clusterTimelineEvents(events, "2026-04-01", "2026-04-30", 290, 25);
  assert.equal(groups.length, 2); assert.equal(groups[0].events.length, 3); assert.equal(groups[0].events[0].date, "2026-04-10");
  assert.equal(clusterTimelineEvents([...events, { ...events[0], id: "business", lane: "business" }], "2026-04-01", "2026-04-30", 290, 25).length, 3);
  assert.equal(timelineWindow(180, "2026-10-09").end, "2026-10-09");
});
