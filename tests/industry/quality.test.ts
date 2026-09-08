import assert from "node:assert/strict";
import { test } from "node:test";
import reviews from "../../src/lib/company-graph/relationship-reviews.json";
import { displayRelationshipTargetName, reviewRelationship, reviewRelationships } from "../../src/lib/company-graph/quality";
import { buildIndustryGraph } from "../../src/lib/industry-graph/model";
import { runFixture } from "./fixtures";

function auditedRun(ticker: string) {
  const decisions = reviews.filter((review) => review.expected.sourceTicker === ticker);
  const first = decisions[0].expected;
  const run = runFixture(ticker, first.sourceCik, ticker, decisions.map((review) => review.expected));
  run.result.filing.accessionNumber = first.accessionNumber;
  return run;
}

test("OEM distribution points from Dell, HP and Lenovo to Microsoft on both read paths", () => {
  const run = auditedRun("MSFT");
  const company = reviewRelationships(run.result.edges);
  assert.ok(company.edges.every((edge) => edge.direction === "target_to_source"));
  const graph = buildIndustryGraph({ MSFT: run });
  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.every((edge) => edge.type === "DISTRIBUTES_FOR" && edge.target === "sec:0000789019"));
  assert.ok(graph.edges.every((edge) => edge.evidence[0].qualityReview?.originalDirection === "source_to_target"));
});

test("console-chip supply is distinct from manufacturing; Sanmina keeps contextual evidence", () => {
  const graph = buildIndustryGraph({ AMD: auditedRun("AMD") });
  assert.equal(graph.edges.filter((edge) => edge.type === "SUPPLIER_OF" && edge.source === "sec:0000002488").length, 3);
  assert.ok(!graph.edges.some((edge) => edge.type === "MANUFACTURES_FOR"));
  const partner = graph.edges.find((edge) => edge.type === "PARTNER_OF")!;
  assert.match(partner.evidence[0].quote, /preferred partner/);
  assert.match(partner.evidence[0].filingUrl, /000000248826000018/);
});

test("unsupported Apple claims are withheld separately from preview limits", () => {
  const run = auditedRun("AAPL");
  const company = reviewRelationships(run.result.edges);
  assert.equal(company.withheldCount, 3);
  assert.equal(company.edges.length, 1);
  const graph = buildIndustryGraph({ AAPL: run });
  assert.ok(graph.nodes.some((node) => node.name === "technology and IP licensors"));
  assert.equal(graph.withheldEdges, 3);
  assert.equal(graph.omittedEdges, 0);
  assert.equal(graph.edges.length, 1);
});

test("Amazon seller revenue supports a customer relationship rather than a partnership", () => {
  const graph = buildIndustryGraph({ AMZN: auditedRun("AMZN") });
  assert.equal(graph.edges[0].type, "CUSTOMER_OF");
  assert.equal(graph.edges[0].target, "sec:0001018724");
  assert.equal(graph.edges[0].bidirectional, false);
});

test("review decisions cannot leak to another filing, target, quote or direction", () => {
  for (const { expected } of reviews) {
    for (const field of Object.keys(expected)) {
      const changed = { ...expected, [field]: `changed-${expected[field as keyof typeof expected]}` };
      assert.strictEqual(reviewRelationship(changed), changed);
    }
    const original = structuredClone(expected);
    reviewRelationship(expected);
    assert.deepEqual(expected, original);
  }
});

test("review is idempotent and trailing punctuation cleanup does not merge entities", () => {
  for (const { expected } of reviews) {
    const reviewed = reviewRelationship(expected);
    if (reviewed) assert.deepEqual(reviewRelationship(reviewed), reviewed);
  }
  assert.equal(displayRelationshipTargetName("Sony Interactive Entertainment,"), "Sony Interactive Entertainment");
  assert.notEqual(displayRelationshipTargetName("Samsung"), displayRelationshipTargetName("Samsung Electronics Co.,"));
});
