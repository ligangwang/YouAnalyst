import test from "node:test";
import assert from "node:assert/strict";
import { reviewedCompanyNames } from "../src/lib/market-companies/reviewed-names";
import { financialReportLabel } from "../src/lib/company-profile";
import { companyOrganizationSchema } from "../src/lib/company-schema";
import { deduplicateUpdates } from "../src/lib/knowledge-graph/feed-order";
import type { CompanyUpdate } from "../src/lib/knowledge-graph/company-updates";
import { relationshipBusiness } from "../src/lib/knowledge-graph/research-view";

test("reviewed translations fill missing names without overriding edits or mismatched identities", () => {
  assert.equal(reviewedCompanyNames("XSHG:688766", "普冉股份", {}).en, "Puya Semiconductor");
  assert.equal(reviewedCompanyNames("XSHG:600588", "用友网络", {}).en, "Yonyou");
  assert.equal(reviewedCompanyNames("XSHG:688766", "普冉股份", { en: "Reviewed admin name" }).en, "Reviewed admin name");
  assert.deepEqual(reviewedCompanyNames("XSHG:688766", "Other company", {}), {});
  assert.deepEqual(reviewedCompanyNames("US:UNKNOWN", "Unknown", {}), {});
});

const update: CompanyUpdate = { id: "a", kind: "BUSINESS", companyIds: ["US:NVDA"], collectedAt: "2026-10-09", eventDate: "2026-10-08", sourceDate: "2026-10-08", sourceUrl: "https://example.com/news", sourceTitle: "NVIDIA announces investment", description: "Investment", href: "/ticker/NVDA" };
test("duplicate URLs and normalized titles collapse repeated imports, with the newest review retained", () => {
  assert.equal(deduplicateUpdates([update, { ...update, id: "b", collectedAt: "2026-10-10", sourceUrl: update.sourceUrl + "?utm_source=feed#news" }])[0].id, "b");
  assert.equal(deduplicateUpdates([update, { ...update, id: "b", sourceUrl: "https://example.com/syndicated", sourceTitle: " NVIDIA  ANNOUNCES investment " }]).length, 1);
  assert.equal(deduplicateUpdates([update, { ...update, id: "b", eventDate: "2026-10-09" }]).length, 2);
  assert.equal(deduplicateUpdates([update, { ...update, id: "b", companyIds: ["US:AMD"] }]).length, 2);
});
test("sharing a source does not discard distinct relationship facts", () => {
  const research = { ...update, kind: "RESEARCH" as const, edgeId: "nvda-amd" };
  assert.equal(deduplicateUpdates([research, { ...research, id: "b", edgeId: "nvda-msft" }, { ...research, id: "c", description: "A different product" }]).length, 3);
  assert.equal(deduplicateUpdates([research, { ...research, id: "b" }]).length, 1);
});
test("raw SEC document rows get readable report labels while editorial titles survive", () => {
  const report = { title: "2 | EX-99.1 | q2fy27pr.htm | EX-99.1 | 341113", form: "8-K", periodEnd: "2026-07-26", publishedAt: "2026-08-26", url: "https://example.com/report" };
  assert.equal(financialReportLabel(report), "8-K financial report (period ended 2026-07-26)");
  assert.match(financialReportLabel(report, true), /财务报告/);
  assert.equal(financialReportLabel({ ...report, title: "Q2 FY27 press release" }), "Q2 FY27 press release");
});
test("relationship labels omit generic fallback and retain supported product details", () => {
  const edge = { id: "e", source: "US:NVDA", target: "US:AMD", type: "PARTNER_OF", summary: "Participates in an ecosystem", commercialStatus: "DOCUMENTED", sourceIds: [] };
  assert.equal(relationshipBusiness(edge, false), "");
  assert.equal(relationshipBusiness({ ...edge, summary: "CUDA integration" }, false), "CUDA");
});
test("organization schema uses canonical localized names and only verified exchange information", () => {
  const company = { id: "US:NVDA", name: "NVIDIA", names: { en: "NVIDIA", "zh-CN": "英伟达" } };
  const schema = companyOrganizationSchema(company, "zh-CN", "https://youanalyst.com/zh-cn/ticker/NVDA", "NVDA", "NASDAQ");
  assert.equal(schema.name, "英伟达");
  assert.equal(schema.tickerSymbol, "NASDAQ: NVDA");
  assert.equal(schema["@id"], "https://youanalyst.com/zh-cn/ticker/NVDA#company");
  assert.equal("tickerSymbol" in companyOrganizationSchema(company, "en", "https://youanalyst.com/en/ticker/NVDA", "NVDA"), false);
});
