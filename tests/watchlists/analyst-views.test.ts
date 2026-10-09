import assert from "node:assert/strict";
import test from "node:test";
import { mergeCoverageGraphs, parseViewEvidence, researchForCompany, resolveViewEvidence } from "../../src/lib/posts/evidence";
import { summarizeCompanyViews } from "../../src/lib/posts/view-summary";
import { computeTrackRecord, trackRecordDates } from "../../src/lib/predictions/track-record";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

const company = (id: string, name: string) => ({ id, kind: "COMPANY" as const, name, order: 0 });
const edge = (id: string, source: string, target: string, type = "SUPPLIER_OF") => ({ id, source, target, type, summary: "", sourceIds: [], commercialStatus: "ACTIVE" });
const ai: KnowledgeGraph = {
  asOf: "2026-10-01", sources: [],
  nodes: [company("US:NVDA", "NVIDIA"), company("US:TSM", "TSMC"), company("US:AMD", "AMD"), { id: "stage:compute", kind: "STAGE", order: 0 }],
  relationships: [edge("tsm-nvda", "US:TSM", "US:NVDA"), edge("tsm-amd", "US:TSM", "US:AMD"), edge("nvda-role", "US:NVDA", "stage:compute", "PARTICIPATES_IN")],
};
const robotics: KnowledgeGraph = { asOf: "2026-10-05", sources: [], nodes: [company("US:ISRG", "Intuitive Surgical"), company("US:NVDA", "NVIDIA")], relationships: [edge("nvda-isrg", "US:NVDA", "US:ISRG", "PARTNER_OF")] };
const coverage = mergeCoverageGraphs([{ theme: "ai", graph: ai }, { theme: "robotics", graph: robotics }]);

test("evidence references are shape-checked, deduplicated and capped", () => {
  assert.deepEqual(parseViewEvidence(undefined), []);
  assert.deepEqual(parseViewEvidence([{ kind: "relationship", id: "tsm-nvda" }, { kind: "relationship", id: "tsm-nvda" }]), [{ kind: "relationship", id: "tsm-nvda" }]);
  assert.throws(() => parseViewEvidence([{ kind: "tweet", id: "x" }]), /Invalid evidence/);
  assert.throws(() => parseViewEvidence("tsm-nvda"), /Invalid evidence/);
  assert.throws(() => parseViewEvidence(Array.from({ length: 6 }, (_, i) => ({ kind: "relationship", id: `e${i}` }))), /up to 5/);
});

test("coverage spans the AI, Robotics and Space maps", () => {
  assert.equal(coverage.nodes.filter(node => node.id === "US:NVDA").length, 1);
  assert.equal(coverage.asOf, "2026-10-05");
  assert.deepEqual(resolveViewEvidence([], "US:ISRG", coverage, false), []);
  assert.throws(() => resolveViewEvidence([], "US:KO", coverage, false), /AI, Robotics and Space maps/);
});

test("directional views must cite a relationship or research that covers the company", () => {
  assert.throws(() => resolveViewEvidence([], "US:NVDA", coverage, true), /Cite at least one/);
  const [cited] = resolveViewEvidence([{ kind: "relationship", id: "tsm-nvda" }], "US:NVDA", coverage, true);
  assert.deepEqual(cited.label, { en: "TSMC → NVIDIA · Supplies", "zh-CN": "TSMC → NVIDIA · 供应" });
  assert.equal(cited.href, "/?theme=ai&company=US%3ANVDA&relationship=tsm-nvda");
  // Another company's relationship, an industry-role membership and an unknown id are all rejected.
  for (const id of ["tsm-amd", "nvda-role", "missing"]) assert.throws(() => resolveViewEvidence([{ kind: "relationship", id }], "US:NVDA", coverage, true), /does not involve/);
  // A relationship from the Robotics map counts for a company on both maps.
  assert.equal(resolveViewEvidence([{ kind: "relationship", id: "nvda-isrg" }], "US:ISRG", coverage, true)[0].href, "/?theme=robotics&company=US%3AISRG&relationship=nvda-isrg");
});

test("research citations must cover the company and link to the report", () => {
  const research = researchForCompany("US:NVDA");
  assert.ok(research.some(item => item.id === "nvidia-ai-ecosystem"));
  const [cited] = resolveViewEvidence([{ kind: "research", id: "nvidia-ai-ecosystem" }], "US:NVDA", coverage, true);
  assert.equal(cited.href, "/research/nvidia-ai-ecosystem");
  assert.ok(cited.label.en && cited.label["zh-CN"]);
  assert.throws(() => resolveViewEvidence([{ kind: "research", id: "nvidia-ai-ecosystem" }], "US:ISRG", coverage, true), /does not cover/);
});

test("company summary counts distinct analysts with active public views and their most cited research", () => {
  const cite = (id: string) => ({ kind: "relationship", id, label: { en: id, "zh-CN": id }, href: `/?relationship=${id}` });
  const summary = summarizeCompanyViews([
    { userId: "a", direction: "UP", status: "OPEN", visibility: "PUBLIC", evidence: [cite("tsm-nvda"), cite("tsm-nvda")] },
    { userId: "a", direction: "UP", status: "CREATED", visibility: "PUBLIC", evidence: [cite("tsm-nvda")] },
    { userId: "b", direction: "DOWN", status: "CLOSING", visibility: "PUBLIC", evidence: [cite("nvda-isrg"), cite("tsm-nvda")] },
    { userId: "c", direction: "UP", status: "SETTLED", visibility: "PUBLIC", evidence: [cite("nvda-isrg")] },
    { userId: "d", direction: "UP", status: "OPEN", visibility: "PRIVATE", evidence: [cite("nvda-isrg")] },
  ]);
  assert.equal(summary.analysts, 2);
  assert.deepEqual([summary.bullish, summary.bearish], [2, 1]);
  assert.deepEqual(summary.citations.map(item => [item.id, item.views]), [["tsm-nvda", 3], ["nvda-isrg", 1]]);
});

test("track record compares each public view with QQQ over the same dates", () => {
  const rows = [
    // Bullish, up 10% while QQQ rose 4%: 6 points ahead.
    { id: "a", ticker: "NVDA", direction: "UP", status: "OPEN", visibility: "PUBLIC", entryDate: "2026-09-01", markPriceDate: "2026-09-30", markReturnValue: 0.1, evidence: [{}] },
    // Bearish and settled: +5% in its direction while QQQ fell 2%, so short QQQ made 2%: 3 points ahead.
    { id: "b", ticker: "AMD", direction: "DOWN", status: "SETTLED", visibility: "PUBLIC", entryDate: "2026-09-02", markPriceDate: "2026-09-29", markReturnValue: 0.01, result: { returnValue: 0.05 } },
    // A-share view: return counts, no US benchmark.
    { id: "c", ticker: "XSHG:688041", direction: "UP", status: "OPEN", visibility: "PUBLIC", entryDate: "2026-09-03", markPriceDate: "2026-09-30", markReturnValue: -0.02 },
    // Excluded: private, canceled, and no entry yet.
    { id: "d", ticker: "NVDA", direction: "UP", status: "OPEN", visibility: "PRIVATE", entryDate: "2026-09-01", markPriceDate: "2026-09-30", markReturnValue: 0.5 },
    { id: "e", ticker: "NVDA", direction: "UP", status: "CANCELED", visibility: "PUBLIC", entryDate: "2026-09-01", markPriceDate: "2026-09-30", markReturnValue: 0.5 },
    { id: "f", ticker: "NVDA", direction: "UP", status: "CREATED", visibility: "PUBLIC", entryDate: null, markPriceDate: null, markReturnValue: null },
  ];
  assert.deepEqual(trackRecordDates(rows), ["2026-09-01", "2026-09-02", "2026-09-29", "2026-09-30"]);
  const record = computeTrackRecord(rows, new Map([["2026-09-01", 100], ["2026-09-30", 104], ["2026-09-02", 100], ["2026-09-29", 98]]));
  assert.equal(record.benchmark, "QQQ");
  assert.deepEqual([record.views, record.open, record.settled, record.benchmarkCovered], [3, 2, 1, 2]);
  assert.equal(record.hitRate, 2 / 3);
  const byId = new Map(record.recent.map(view => [view.id, view]));
  assert.ok(Math.abs(byId.get("a")!.excessReturn! - 0.06) < 1e-9);
  assert.ok(Math.abs(byId.get("b")!.benchmarkReturn! - 0.02) < 1e-9);
  assert.ok(Math.abs(byId.get("b")!.excessReturn! - 0.03) < 1e-9);
  assert.equal(byId.get("c")!.benchmarkReturn, null);
  assert.ok(Math.abs(record.averageExcess! - 0.045) < 1e-9);
  assert.equal(byId.get("a")!.cited, 1);
  assert.deepEqual(record.recent.map(view => view.id), ["c", "b", "a"]);
});


test("Space citations retain their theme and shared relationships prefer their first map", () => {
  const space: KnowledgeGraph = { asOf: "2026-10-06", sources: [], nodes: [company("US:RKLB", "Rocket Lab"), company("US:IRDM", "Iridium")], relationships: [edge("rklb-irdm", "US:RKLB", "US:IRDM", "PARTNER_OF")] };
  const graph = mergeCoverageGraphs([{ theme: "ai", graph: ai }, { theme: "robotics", graph: robotics }, { theme: "space", graph: space }]);
  const citation = resolveViewEvidence([{ kind: "relationship", id: "rklb-irdm" }], "US:RKLB", graph, true)[0];
  assert.equal(new URL(citation.href, "https://youanalyst.com").searchParams.get("theme"), "space");
  const duplicate = mergeCoverageGraphs([{ theme: "ai", graph: ai }, { theme: "robotics", graph: ai }]);
  assert.equal(duplicate.relationshipThemes["tsm-nvda"], "ai");
});
