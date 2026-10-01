import { test } from "node:test";
import assert from "node:assert/strict";
import { companyUpdates } from "../../src/lib/knowledge-graph/company-updates";
import { collectedLater, groupFeedUpdates, orderFeed } from "../../src/lib/knowledge-graph/feed-order";
import type { BusinessEvent } from "../../src/lib/knowledge-graph/business-events";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

const company = (id: string, name: string, order: number) => ({ id, kind: "COMPANY" as const, market: "US" as const, name, symbol: name, stageIds: ["compute"], order });
const graph: KnowledgeGraph = {
  asOf: "2026-09-20",
  nodes: [company("US:AMD", "AMD", 1), company("US:CSCO", "CSCO", 2), company("US:MU", "MU", 3)],
  sources: [
    { id: "humain", title: "HUMAIN deployment", url: "https://example.com/humain-review", sourceDate: "2026-08-31" },
    { id: "hbm", title: "HBM supply", url: "https://example.com/hbm", sourceDate: "2026-09-10" },
    { id: "undated", title: "Undated review", url: "https://example.com/undated", sourceDate: "2026-06-01" },
  ],
  relationships: [
    { id: "US:AMD__PARTNER_OF__US:CSCO", source: "US:AMD", target: "US:CSCO", type: "PARTNER_OF", summary: "HUMAIN live", commercialStatus: "DOCUMENTED", sourceIds: ["humain"], facts: [{ id: "live", scope: "HUMAIN systems live", state: "DOCUMENTED", sourceIds: ["humain"], eventDate: "2026-08-31", reviewedAt: "2026-09-18" }] },
    { id: "mu-amd", source: "US:MU", target: "US:AMD", type: "SUPPLIER_OF", summary: "HBM", commercialStatus: "DOCUMENTED", sourceIds: ["hbm", "undated"], facts: [
      { id: "hbm", scope: "HBM supply", state: "DOCUMENTED", sourceIds: ["hbm"], eventDate: "2026-09-10", reviewedAt: "2026-09-12" },
      { id: "undated", scope: "Undated review", state: "DOCUMENTED", sourceIds: ["undated"], reviewedAt: "2026-09-19" },
    ] },
  ],
};
const humain: BusinessEvent = { id: "amd-cisco-humain-live-20260831", category: "PRODUCT", companyIds: ["US:AMD", "US:CSCO"], relationshipId: "US:AMD__PARTNER_OF__US:CSCO", eventDate: "2026-08-31", sourceDate: "2026-08-31", collectedAt: "2026-09-16", planned: false, title: "AMD and Cisco report HUMAIN systems are live", titleZh: "AMD 与思科宣布 HUMAIN 系统已上线", summary: "Live", summaryZh: "上线", sourceTitle: "AMD", sourceUrl: "https://example.com/humain" };
const older: BusinessEvent = { ...humain, id: "older", relationshipId: undefined, companyIds: ["US:MU"], eventDate: "2025-01-05", collectedAt: "2026-09-20", sourceUrl: "https://example.com/older", title: "Older event" };
const updates = companyUpdates(graph, graph.nodes.map(n => n.id), [humain, older]);

test("evidence for the same event is grouped under its event card", () => {
  const entries = groupFeedUpdates(updates);
  const event = entries.find(e => e.item.id === humain.id)!;
  assert.deepEqual(event.evidence.map(e => e.id), ["US:AMD__PARTNER_OF__US:CSCO:live"]);
  assert.equal(entries.some(e => e.item.id === "US:AMD__PARTNER_OF__US:CSCO:live"), false);
  // A different date or relationship stays a separate card.
  assert.ok(entries.some(e => e.item.id === "mu-amd:hbm"));
  assert.equal(entries.length, updates.length - 1);
});

test("feed orders by event date, then source publication, with collection kept separate", () => {
  const byEvent = orderFeed(groupFeedUpdates(updates), "event").map(e => e.item.id);
  assert.deepEqual(byEvent, ["mu-amd:hbm", humain.id, "mu-amd:undated", "older"]);
  const byAdded = orderFeed(groupFeedUpdates(updates), "added").map(e => e.item.id);
  assert.deepEqual(byAdded, ["older", "mu-amd:undated", humain.id, "mu-amd:hbm"]);
});

test("later collection is flagged only when the event predates collection", () => {
  const find = (id: string) => updates.find(u => u.id === id)!;
  assert.equal(collectedLater(find(humain.id)), true);
  assert.equal(collectedLater(find("mu-amd:undated")), false);
  assert.equal(collectedLater({ ...find("mu-amd:hbm"), collectedAt: "2026-09-10T20:00:00Z" }), false);
});
