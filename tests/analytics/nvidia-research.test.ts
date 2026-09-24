import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { researchFilters, selectedConnections, researchConnections, researchCompanies, layerSummaries, roadmap, LAYERS, REVIEWED, RESEARCH_PATH } from "../../src/lib/research/nvidia-ecosystem";
import { companyLinks, deepDives } from "../../src/lib/research/deep-dives";
import { isLocalizedPage } from "../../src/lib/i18n/urls";

const graph = JSON.parse(readFileSync("data/ai-supply-chain/ai-us.json", "utf8")) as { relationships: { id: string }[] };

test("filters separate shipped evidence from announced plans and reject unknown values", () => {
  assert.deepEqual(researchFilters("<script>", "x", "y"), { layer: "all", kind: "all", stage: "all" });
  assert.deepEqual(selectedConnections("cloud", "customer", "announced").map(r => r.id), ["amzn-rubin", "openai-loi", "anthropic-compute"]);
  assert(selectedConnections("chips", "supplier", "shipped").some(r => r.id === "tsm-wafers"));
  assert(selectedConnections("all", "all", "shipped").every(r => r.stage === "shipped"));
  assert.equal(selectedConnections("software", "all").length, 0);
});

test("every claim carries a dated https primary source with bilingual text", () => {
  assert.equal(new Set(researchConnections.map(r => r.id)).size, researchConnections.length);
  const evidence = [...researchConnections, ...layerSummaries, ...roadmap].flatMap(e => [e, ...(("also" in e && e.also) || [])]);
  for (const e of evidence) {
    assert.equal(new URL(e.url).protocol, "https:");
    if (e.date) { assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/); assert(e.date <= REVIEWED, `${e.source} is dated after review`); }
  }
  for (const r of researchConnections) assert(r.summary.en && r.summary.zh && r.limit.en && r.limit.zh && r.label.zh);
  assert.deepEqual(layerSummaries.map(s => s.layer), [...LAYERS]);
  assert.deepEqual(roadmap.map(r => r.name), ["Blackwell", "Blackwell Ultra (GB300)", "Vera Rubin"]);
  assert(isLocalizedPage(RESEARCH_PATH) && isLocalizedPage("/research"));
});

test("map links only point at relationships and companies the map knows", () => {
  const ids = new Set(graph.relationships.map(r => r.id));
  for (const r of researchConnections) if (r.edge) assert(ids.has(r.edge), r.edge);
  assert.deepEqual(companyLinks("US:NVDA", "/en", "US:TSM__SUPPLIER_OF__US:NVDA"), { page: "/en/ticker/NVDA", map: "/en?company=US%3ANVDA&relationship=US%3ATSM__SUPPLIER_OF__US%3ANVDA" });
  assert.equal(companyLinks("ORG:ANTHROPIC", "/zh-cn")?.page, "/zh-cn/company/ORG%3AANTHROPIC");
  assert.equal(companyLinks("KR:SK-HYNIX", "/en"), null);
  assert(researchCompanies.some(c => c.symbol === null), "companies outside the directory stay unlinked");
});

test("the home teaser and research index list every deep-dive", () => {
  assert.deepEqual(deepDives.map(d => d.path), ["/research/nvidia-ai-ecosystem", "/research/amd-ai-ecosystem"]);
  for (const d of deepDives) assert(d.highlights.length && d.companies.length && d.title.zh);
});
