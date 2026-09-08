import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndustryGraph, selectNeighborhood } from "../../src/lib/industry-graph/model";
import { fixtureRuns, runFixture } from "./fixtures";

test("empty source creates coverage starting points with no fabricated connections", () => {
  const graph = buildIndustryGraph({});
  assert.equal(graph.nodes.length, 16);
  assert.ok(graph.nodes.every((node) => node.kind === "coverage"));
  assert.equal(graph.edges.length, 0);
});
test("only completed current persisted extractions enter the map", () => {
  const run = fixtureRuns.NVDA;
  for (const rejected of [
    { ...run, status: "RUNNING" }, { ...run, extractionVersion: "old" },
    { ...run, result: { ...run.result, dryRun: true } },
    { ...run, result: { ...run.result, ticker: "OTHER" } },
  ]) assert.equal(buildIndustryGraph({ NVDA: rejected }).edges.length, 0);
});
test("supplier direction and evidence provenance are retained; name joins are provisional", () => {
  const graph = buildIndustryGraph(fixtureRuns);
  const edge = graph.edges.find((item) => item.source === "sec:0000723125")!;
  assert.equal(edge.target, "sec:0001045810");
  assert.equal(edge.type, "SUPPLIER_OF");
  assert.equal(edge.evidence[0].nameMatched, true);
  assert.match(edge.evidence[0].filingUrl, /^https:\/\/www.sec.gov\/Archives\/edgar\/data\/1045810\//);
});
test("category targets and unresolved names are not falsely assigned company identity", () => {
  const graph = buildIndustryGraph(fixtureRuns);
  assert.ok(graph.nodes.some((node) => node.kind === "category" && node.ticker === null));
  assert.ok(graph.nodes.some((node) => node.name === "Unresolved Foundry" && node.kind === "mention"));
  assert.ok(!selectNeighborhood(graph, [], "all", false).nodes.some((node) => node.kind === "category"));
});
test("ambiguous exact names remain mentions rather than arbitrary identity joins", () => {
  const runs = structuredClone(fixtureRuns);
  runs.AMD.result.companyName = "Micron";
  const graph = buildIndustryGraph(runs);
  assert.ok(graph.nodes.some((node) => node.name === "Micron" && node.kind === "mention"));
});
test("foreign filing edges, missing evidence and malformed ontology are rejected", () => {
  const variants = [
    { sourceCik: "0000000001" }, { sourceTicker: "MU" }, { accessionNumber: "bad" },
    { evidenceText: "" }, { direction: "wrong" }, { relationshipType: "made_up" },
    { confidence: NaN }, { confidence: 2 }, { targetType: "wrong" },
  ];
  for (const variant of variants) {
    const run = runFixture("NVDA", "0001045810", "NVIDIA", [{ targetName: "Test", ...variant }]);
    assert.equal(buildIndustryGraph({ NVDA: run }).edges.length, 0);
  }
});
test("view is bounded and every edge has existing endpoints", () => {
  const run = runFixture("NVDA", "0001045810", "NVIDIA", Array.from({ length: 80 }, (_, i) => ({ targetName: `Company ${i}` })));
  const graph = buildIndustryGraph({ NVDA: run });
  assert.ok(graph.nodes.length <= 60);
  assert.ok(graph.omittedEdges > 0);
  const ids = new Set(graph.nodes.map((node) => node.id));
  assert.ok(graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)));
});
test("expansion reveals another issuer's neighbors while filters remain applied", () => {
  const graph = buildIndustryGraph(fixtureRuns);
  const first = selectNeighborhood(graph, ["sec:0001045810"], "all", false);
  assert.ok(!first.nodes.some((node) => node.name === "Example Packaging"));
  const expanded = selectNeighborhood(graph, ["sec:0001045810", "sec:0000002488"], "all", false);
  assert.ok(expanded.nodes.some((node) => node.name === "Example Packaging"));
  const filtered = selectNeighborhood(graph, [], "COMPETES_WITH", false);
  assert.equal(filtered.edges.length, 1);
});
test("repeated extraction evidence does not create duplicate edges", () => {
  const runs = structuredClone(fixtureRuns);
  runs.NVDA.result.edges.push(runs.NVDA.result.edges[0]);
  assert.equal(buildIndustryGraph(runs).edges.length, buildIndustryGraph(fixtureRuns).edges.length);
});
