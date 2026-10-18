import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANY_SITEMAP_BUCKETS, companyBucketPrefix, companySitemapPath, companySitemapXml } from "../../src/lib/ui/i18n/company-sitemaps";

test("US and A-share IDs fall into exactly one sitemap range", () => {
  for (const id of ["US:NVDA", "US:AMD", "US:BRK.B", "US:0TEST", "XSHG:688041", "XSHG:600584", "XSHE:002837", "XSHE:300308"]) {
    assert.equal(COMPANY_SITEMAP_BUCKETS.filter(bucket => id.startsWith(companyBucketPrefix(bucket)!)).length, 1);
  }
  assert.equal(companyBucketPrefix("../private"), null);
});
test("sitemaps include valid public companies and omit unpublished A-shares", () => {
  assert.equal(companyBucketPrefix("ORG"), "ORG:");
  assert.equal(companySitemapPath("ORG:OPENAI", { name: "OpenAI", status: "DIRECTORY" }), "/company/openai");
  assert.equal(companySitemapPath("ORG:OPENAI", { name: "OpenAI", status: "DRAFT" }), null);
  assert.equal(companySitemapPath("US:NVDA", { name: "NVIDIA" }), "/company/nvidia");
  const company = { name: "海光信息", market: "CN_A", status: "DIRECTORY", stage: "AI", description: "Company", source: "https://example.com/report", sourceLabel: "Report" };
  assert.equal(companySitemapPath("XSHG:688041", company), "/company/hygon-information");
  assert.equal(companySitemapPath("XSHG:688041", { ...company, status: "DRAFT" }), null);
  const body = companySitemapXml(["/company/nvidia", "/company/hygon-information", "/company/nvidia"]);
  assert.equal((body.match(/<url>/g) ?? []).length, 4);
  assert.ok(body.includes('hreflang="zh-CN"'));
  assert.ok(body.includes('/en/company/nvidia'));
  assert.ok(body.includes('/zh-cn/company/hygon-information'));
});
