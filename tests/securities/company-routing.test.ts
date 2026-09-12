import { test } from "node:test";
import assert from "node:assert/strict";
import { chinaCompanyId, companyPageUrl } from "../../src/lib/market-companies/routes";
import { publicChinaCompany } from "../../src/lib/industry-research/china-directory";

test("company links separate Shanghai, Shenzhen and US symbols", () => {
  assert.equal(companyPageUrl("NPKI", "US"), "/ticker/NPKI");
  assert.equal(companyPageUrl("688041", "CN_A"), "/ticker/XSHG:688041");
  assert.equal(companyPageUrl("002837", "CN_A"), "/ticker/XSHE:002837");
  assert.equal(companyPageUrl("300308", "CN_A"), "/ticker/XSHE:300308");
  assert.equal(chinaCompanyId("xshg:688041"), "XSHG:688041");
  for (const invalid of ["NPKI", "XSHE:688041", "XSHG:002837", "../688041", "68804"]) assert.equal(chinaCompanyId(invalid), null);
});

test("detail and directory share the same publication and source rules", () => {
  const data = { market: "CN_A", status: "DIRECTORY", name: "海光信息", classification: [{ name: "半导体" }], source: "https://example.com/report", sourceLabel: "公司报告" };
  const company = publicChinaCompany("XSHG:688041", data);
  assert.equal(company?.name, data.name);
  assert.equal(company?.description, "半导体");
  for (const status of ["DRAFT", "ARCHIVED", "RESEARCHING"]) assert.equal(publicChinaCompany("XSHG:688041", { ...data, status }), null);
  assert.equal(publicChinaCompany("XSHG:688041", { ...data, source: "javascript:alert(1)" }), null);
});
