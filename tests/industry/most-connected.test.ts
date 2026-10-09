import assert from "node:assert/strict";
import { test } from "node:test";
import { mostConnectedCompanies } from "../../src/lib/knowledge-graph/most-connected";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

const company = (id: string, name: string, stageIds: string[]) => ({ id, kind: "COMPANY" as const, name, symbol: id.split(":")[1], market: "US" as const, order: 0, stageIds });
const edge = (id: string, source: string, target: string, type = "SUPPLIER_OF") => ({ id, source, target, type, summary: "", sourceIds: [], commercialStatus: "ACTIVE" });
const graph: KnowledgeGraph = {
  asOf: "2026-09-24", sources: [],
  nodes: [
    { id: "stage:compute", kind: "STAGE", order: 0 },
    company("US:NVDA", "NVIDIA", ["compute", "networking"]),
    company("US:MSFT", "Microsoft", ["cloud"]),
    company("US:TSM", "TSMC", ["foundry"]),
    company("US:AMD", "AMD", ["compute"]),
    company("US:CEG", "Constellation", ["energy"]),
  ],
  relationships: [
    edge("a", "US:TSM", "US:NVDA"), edge("b", "US:NVDA", "US:MSFT", "PARTNER_OF"), edge("c", "US:TSM", "US:AMD"),
    edge("d", "US:CEG", "US:MSFT", "ENERGY_AGREEMENT_WITH"), edge("g", "US:AMD", "US:NVDA", "PARTNER_OF"),
    // Industry-role memberships and edges to unknown nodes are not company connections.
    edge("e", "US:NVDA", "stage:compute", "PARTICIPATES_IN"), edge("f", "US:NVDA", "ORG:UNKNOWN"),
  ],
};

test("ranks companies by documented company connections with the shared primary sector", () => {
  const ranked = mostConnectedCompanies(graph);
  assert.deepEqual(ranked.map(r => [r.company.id, r.connections, r.layer?.id]), [
    ["US:NVDA", 3, "compute"], ["US:AMD", 2, "compute"], ["US:MSFT", 2, "platforms"], ["US:TSM", 2, "semiconductors"], ["US:CEG", 1, "infrastructure"],
  ]);
});

test("limits the list and omits companies without connections", () => {
  assert.deepEqual(mostConnectedCompanies(graph, 2).map(r => r.company.id), ["US:NVDA", "US:AMD"]);
  assert.deepEqual(mostConnectedCompanies({ ...graph, relationships: [] }), []);
});
