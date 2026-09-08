import assert from "node:assert/strict";
import { test } from "node:test";
import { discoveryQuestions, discoveryView } from "../../src/lib/industry-graph/discovery";
import { buildIndustryGraph } from "./fixtures";
import { fixtureGraph, runFixture } from "./fixtures";

test("discovery distinguishes incoming suppliers from outgoing supply and excludes categories", () => {
  const questions = discoveryQuestions(fixtureGraph);
  const incoming = questions.find((question) => question.ticker === "NVDA")!;
  assert.equal(incoming.edges.length, 2);
  assert.ok(incoming.edges.every((edge) => edge.target === incoming.company.id));
  const outgoing = questions.find((question) => question.ticker === "MU")!;
  assert.equal(outgoing.edges.length, 1);
  assert.ok(outgoing.edges.every((edge) => edge.source === outgoing.company.id));
  assert.ok(!questions.some((question) => question.ticker === "TSM"));
  const view = discoveryView(fixtureGraph, outgoing);
  assert.deepEqual(view.nodes.map((node) => node.ticker).sort(), ["MU", "NVDA"]);
  assert.deepEqual(view.edges, outgoing.edges);
});

test("empty, unsupported or ambiguous relationships never create a discovery claim", () => {
  assert.deepEqual(discoveryQuestions(buildIndustryGraph({})), []);
  const graph = structuredClone(fixtureGraph);
  graph.edges = graph.edges.map((edge) => ({ ...edge, bidirectional: true }));
  assert.deepEqual(discoveryQuestions(graph), []);
  graph.edges = fixtureGraph.edges.map((edge) => ({ ...edge, evidence: [] }));
  assert.deepEqual(discoveryQuestions(graph), []);
});

test("TSMC discovery uses other issuers' evidence without inventing its own filing", () => {
  const graph = buildIndustryGraph({ NVDA: runFixture("NVDA", "0001045810", "NVIDIA", [{ targetName: "Taiwan Semiconductor Manufacturing" }]) });
  const question = discoveryQuestions(graph).find((item) => item.ticker === "TSM")!;
  assert.equal(question.company.kind, "coverage");
  assert.equal(question.edges.length, 1);
  assert.equal(question.edges[0].evidence[0].issuerTicker, "NVDA");
});
