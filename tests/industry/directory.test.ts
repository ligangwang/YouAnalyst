import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndustryGraph } from "../../src/lib/industry-graph/model";
import { readMapCompany, readMapOptions } from "../../src/lib/industry-graph/directory";
import { buildCompanyResearch } from "../../src/lib/company-research";
import { runFixture } from "./fixtures";

test("published companies enter without an editorial entry; empty data fabricates no starters", () => {
  assert.equal(buildIndustryGraph({}).nodes.length, 0);
  const run = runFixture("CRM", "0001108524", "Salesforce", [{ targetName: "Example Supplier" }]);
  const graph = buildIndustryGraph({ CRM: run });
  assert.deepEqual(graph.coveredTickers, ["CRM"]);
  assert.equal(graph.nodes[0].name, "Salesforce");
  assert.equal(graph.nodes[0].segment, "other");
  assert.equal(graph.edges.length, 1);
  assert.equal(buildCompanyResearch("CRM", [], graph).inMap, true);
  assert.equal(buildIndustryGraph({ CRM: { ...run, status: "FAILED" } }).nodes.length, 0);
  assert.equal(buildIndustryGraph({ CRM: { ...run, result: { ...run.result, dryRun: true } } }).nodes.length, 0);
});

test("database metadata controls names, aliases and grouping without inventing classifications", () => {
  const company = readMapCompany("CRM", { name: "Salesforce", aliases: ["Salesforce Inc", null], segment: "cloud" })!;
  const graph = buildIndustryGraph({}, [company]);
  assert.equal(graph.nodes[0].segment, "cloud");
  assert.deepEqual(graph.nodes[0].aliases, ["Salesforce Inc"]);
  assert.equal(readMapCompany("CRM", { name: "Salesforce", segment: "fiction" })?.segment, "other");
  assert.equal(readMapCompany("../BAD", { name: "Bad" }), null);
});

test("map query normalizes ticker input and rejects invalid cursors", () => {
  assert.deepEqual(readMapOptions(new URLSearchParams("company=%24crm&after=NVDA_latest_10k")), { ticker: "CRM", after: "NVDA_latest_10k" });
  for (const input of ["company=../bad", "after=../bad", `after=${"A".repeat(101)}`]) {
    assert.throws(() => readMapOptions(new URLSearchParams(input)));
  }
});


// Public company pages use exactly the same published graph as the main map.
import { companyResearchGraph } from "../../src/lib/knowledge-graph/company-research-projection";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { GET as retiredGraph } from "../../src/app/api/industry-graph/route";
const publishedGraph: KnowledgeGraph = {
  asOf: "2026-09-15", nodes: [
    { id: "US:AMD", kind: "COMPANY", name: "AMD", symbol: "AMD", market: "US", order: 0, stageIds: ["compute"] },
    { id: "XSHG:688041", kind: "COMPANY", name: "Hygon", symbol: "688041", market: "CN_A", order: 1 },
    { id: "ORG:private", kind: "COMPANY", name: "Private Company", market: "GLOBAL", order: 2 },
    { id: "stage:compute", kind: "STAGE", order: 3 },
  ],
  relationships: [
    { id: "incoming", source: "XSHG:688041", target: "US:AMD", type: "SUPPLIER_OF", summary: "Published supporting summary.", sourceIds: ["source"], commercialStatus: "DOCUMENTED" },
    { id: "planned", source: "US:AMD", target: "ORG:private", type: "PLANNED_ADOPTER_OF", summary: "Announced plans only.", sourceIds: ["source"], commercialStatus: "ANNOUNCED" },
    { id: "stage", source: "US:AMD", target: "stage:compute", type: "PARTICIPATES_IN", summary: "", sourceIds: [], commercialStatus: "" },
  ],
  sources: [{ id: "source", title: "Company announcement", url: "https://example.com/announcement", sourceDate: null }],
};
test("company profiles retain canonical relationship directions, sources and international destinations", () => {
  const projection = companyResearchGraph(publishedGraph);
  assert.deepEqual(projection.nodes.map(n => n.id), ["US:AMD", "XSHG:688041", "ORG:private"]);
  assert.deepEqual(projection.edges.map(e => e.id), ["incoming", "planned"]);
  const company = buildCompanyResearch("AMD", [], projection);
  assert.equal(company.connections[0].label, "Hygon supplies AMD");
  assert.equal(company.connections[0].related.profileUrl, "/ticker/XSHG:688041");
  assert.equal(company.connections[0].evidence[0].filingUrl, publishedGraph.sources[0].url);
  assert.equal(company.connections[0].evidence[0].sourceKind, "web");
  assert.equal(company.connections[1].related.profileUrl, "/company/ORG%3Aprivate");
  assert.equal(company.connections[1].commercialStatus, "ANNOUNCED");
  assert.equal(company.connections[1].summary, "Announced plans only.");
  assert.equal(buildCompanyResearch("688041", [], projection).inMap, false);
});
test("retired API returns Gone without loading an independent dataset", async () => {
  const response = retiredGraph();
  assert.equal(response.status, 410);
  assert.equal((await response.json()).replacement, "/api/knowledge-graph");
});

import { relationLabels } from "../../src/lib/knowledge-graph/relationship-labels";
import { RELATIONSHIP_LABELS } from "../../src/lib/industry-graph/model";
import { translateUi } from "../../src/lib/i18n/translate";
test("company relationship labels cover canonical types and translate complete headings", () => {
  for (const type of Object.keys(relationLabels).filter(type => type !== "PARTICIPATES_IN")) {
    assert.ok(RELATIONSHIP_LABELS[type], type);
  }
  for (const [type, expected] of [
    ["INTEGRATES_TECHNOLOGY_FROM", "AMD 集成 Private Company 的技术"],
    ["PLANNED_ADOPTER_OF", "AMD 计划采用 Private Company 的技术"],
    ["ECOSYSTEM_PARTNER_OF", "AMD 是 Private Company 的生态伙伴"],
    ["ENERGY_AGREEMENT_WITH", "AMD 与 Private Company 签订能源协议"],
  ]) {
    const graph = { ...publishedGraph, relationships: [{ ...publishedGraph.relationships[1], type }] };
    const label = buildCompanyResearch("AMD", [], companyResearchGraph(graph)).connections[0].label;
    assert.equal(translateUi(label, "zh-CN"), expected);
    assert.equal(translateUi(label, "en"), label);
  }
});
