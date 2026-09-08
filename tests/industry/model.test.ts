import assert from "node:assert/strict";
import { test } from "node:test";
import { selectNeighborhood } from "../../src/lib/industry-graph/model";
import { buildIndustryGraph } from "./fixtures";
import { fixtureRuns, runFixture } from "./fixtures";
import { INDUSTRY_STARTERS } from "../../src/lib/industry-graph/catalog";
import { layoutIndustryGraph } from "../../src/lib/industry-graph/layout";

test("empty source creates coverage starting points with no fabricated connections", () => {
  const graph = buildIndustryGraph({});
  assert.equal(graph.nodes.length, INDUSTRY_STARTERS.length);
  assert.ok(graph.nodes.every((node) => node.kind === "coverage"));
  assert.equal(graph.edges.length, 0);
});
test("Sandisk is a distinct memory starter, with only current-issuer filing coverage", () => {
  const empty = buildIndustryGraph({});
  assert.deepEqual(empty.nodes.filter((node) => node.segment === "memory").map((node) => node.ticker), ["MU", "SNDK", "WDC"]);
  assert.equal(empty.nodes.find((node) => node.ticker === "SNDK")?.kind, "coverage");
  const current = runFixture("SNDK", "0002023554", "Sandisk Corporation", [{ targetName: "Western Digital" }]);
  const graph = buildIndustryGraph({ SNDK: current });
  assert.deepEqual(graph.coveredTickers, ["SNDK"]);
  assert.equal(graph.nodes.find((node) => node.ticker === "SNDK")?.id, "sec:0002023554");
  assert.equal(graph.edges.length, 1);
  const legacy = runFixture("SNDK", "0001000180", "SanDisk Corporation", [{ targetName: "Western Digital" }]);
  const rejected = buildIndustryGraph({ SNDK: legacy });
  assert.equal(rejected.edges.length, 0);
  assert.deepEqual(rejected.coveredTickers, []);
});

test("Sandisk name evidence joins provisionally without reassigning Western Digital", () => {
  const graph = buildIndustryGraph({ NVDA: runFixture("NVDA", "0001045810", "NVIDIA", [
    { targetName: "SanDisk" }, { targetName: "Sandisk Corporation" }, { targetName: "Western Digital" },
  ]) });
  const sandisk = selectNeighborhood(graph, ["coverage:SNDK"], "all", false);
  assert.equal(sandisk.edges.length, 1);
  assert.equal(sandisk.edges[0].evidence.length, 2);
  assert.ok(sandisk.edges[0].evidence.every((item) => item.nameMatched));
  assert.equal(selectNeighborhood(graph, ["coverage:WDC"], "all", false).edges.length, 1);
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

test("uncovered starters retain incoming evidence through provisional names and aliases", () => {
  const graph = buildIndustryGraph({ NVDA: runFixture("NVDA", "0001045810", "NVIDIA", [
    { targetName: "Micron" }, { targetName: "Micron Technology," }, { targetName: "Advanced Micro Devices" },
  ]) });
  assert.deepEqual(graph.coveredTickers, ["NVDA"]);
  assert.equal(graph.nodes.filter((node) => node.ticker === "MU").length, 1);
  assert.ok(!graph.nodes.some((node) => node.kind === "mention"));
  const micron = selectNeighborhood(graph, ["coverage:MU"], "all", false);
  assert.equal(micron.edges.length, 1);
  assert.equal(micron.edges[0].evidence.length, 2);
  assert.ok(micron.edges[0].evidence.every((item) => item.nameMatched));
  assert.equal(selectNeighborhood(graph, ["coverage:AMD"], "all", false).edges.length, 1);
});

test("overview reduces clutter without discarding searchable filing mentions", () => {
  const graph = buildIndustryGraph(fixtureRuns);
  const overview = selectNeighborhood(graph, [], "all", false, true);
  assert.equal(overview.nodes.length, INDUSTRY_STARTERS.length);
  assert.ok(overview.nodes.every((node) => node.ticker));
  assert.equal(overview.edges.length, 2);
  const focus = selectNeighborhood(graph, ["sec:0001045810"], "all", false);
  assert.ok(focus.nodes.some((node) => node.name === "Unresolved Foundry"));
});

test("bounded preview includes later issuers even when an earlier issuer has many mentions", () => {
  const targets = Array.from({ length: 50 }, (_, i) => ({ targetName: `Supplier ${i}` }));
  const graph = buildIndustryGraph({
    NVDA: runFixture("NVDA", "0001045810", "NVIDIA", targets),
    AAPL: runFixture("AAPL", "0000320193", "Apple", targets),
    QCOM: runFixture("QCOM", "0000804328", "Qualcomm", targets),
  });
  assert.deepEqual(graph.coveredTickers, ["NVDA", "AAPL", "QCOM"]);
  assert.deepEqual(graph.coveredTickers.map((ticker) => graph.edges.filter((edge) => edge.evidence[0].issuerTicker === ticker).length), [14, 13, 13]);
  assert.equal(graph.nodes.length, 60);
  assert.equal(graph.omittedEdges, 110);
});

test("invalid filing accessions never inflate the omitted connection count", () => {
  for (const accessionNumber of ["", "malformed"]) {
    const run = runFixture("NVDA", "0001045810", "NVIDIA", Array.from({ length: 80 }, (_, i) => ({ targetName: `Supplier ${i}` })));
    run.result.filing.accessionNumber = accessionNumber;
    const graph = buildIndustryGraph({ NVDA: run });
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.omittedEdges, 0);
  }
});

test("TSMC is an overview company and joins actual filing names without claiming its own 10-K", () => {
  const graph = buildIndustryGraph({
    NVDA: runFixture("NVDA", "0001045810", "NVIDIA", [{ targetName: "Taiwan Semiconductor Manufacturing" }]),
    AMD: runFixture("AMD", "0000002488", "AMD", [{ targetName: "Taiwan Semiconductor Manufacturing Company Limited" }]),
    QCOM: runFixture("QCOM", "0000804328", "Qualcomm", [{ targetName: "TSMC" }]),
    TSM: runFixture("TSM", "0001046179", "TSMC", []),
  });
  const overview = selectNeighborhood(graph, [], "all", false, true);
  const tsm = overview.nodes.find((node) => node.ticker === "TSM")!;
  assert.equal(tsm.name, "TSMC");
  assert.equal(tsm.segment, "manufacturing");
  assert.equal(tsm.kind, "coverage");
  assert.ok(!graph.coveredTickers.includes("TSM"));
  assert.equal(overview.nodes.find((node) => node.ticker === "INTC")?.segment, "compute");
  assert.equal(overview.edges.filter((edge) => edge.source === tsm.id).length, 3);
  assert.ok(overview.edges.every((edge) => edge.evidence[0].nameMatched));
  assert.ok(!graph.nodes.some((node) => node.kind === "mention"));
});

test("wrapped layout keeps every node inside the readable canvas across viewport sizes", () => {
  const graph = buildIndustryGraph(fixtureRuns);
  for (const width of [300, 388, 750, 1100]) {
    const layout = layoutIndustryGraph(graph.nodes, width);
    assert.equal(layout.width, width);
    assert.equal(layout.positions.size, graph.nodes.length);
    const locations = new Set<string>();
    for (const { x, y } of layout.positions.values()) {
      assert.ok(x - 74 >= 0 && x + 74 <= width);
      assert.ok(y - 28 >= 0 && y + 28 <= layout.height);
      const key = `${x},${y}`;
      assert.ok(!locations.has(key));
      locations.add(key);
    }
  }
});
