import test from "node:test";
import assert from "node:assert/strict";
import { researchFilters, selectedConnections, researchConnections, REVIEWED } from "../../src/lib/research/amd-ecosystem";
import { localizedPath, isLocalizedPage } from "../../src/lib/i18n/urls";

test("research filters distinguish available CPU adoption from rack plans and preserve multi-product integration", () => {
  assert.deepEqual(selectedConnections("EPYC","integration").map(r=>r.symbol),["AMZN","DELL"]);
  assert.deepEqual(selectedConnections("Helios","planned").map(r=>r.symbol),["HPE"]);
  assert.equal(selectedConnections("EPYC","planned").length,0);
  assert.deepEqual(researchFilters("<script>","invalid"),{product:"all",kind:"all"});
});
test("editorial evidence keeps original source dates separate from review dates", () => {
  assert.equal(new Set(researchConnections.map(r=>r.id)).size,researchConnections.length);
  assert.equal(researchConnections.find(r=>r.symbol==="MU")?.date,null);
  assert.notEqual(researchConnections.find(r=>r.symbol==="HPE")?.date,REVIEWED);
  for(const row of researchConnections) {
    assert.equal(new URL(row.url).protocol,"https:");
    assert(row.summary.en && row.summary.zh && row.limit.en && row.limit.zh);
  }
  assert(isLocalizedPage("/research/amd-ai-ecosystem"));
  assert.equal(localizedPath("/research/amd-ai-ecosystem?product=EPYC&relation=integration","zh-CN"),"/zh-cn/research/amd-ai-ecosystem?product=EPYC&relation=integration");
});
