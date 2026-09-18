import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { buildCompanyResearch, companyResearchDescription } from "../../src/lib/company-research";
import { fixtureGraph } from "./fixtures";

test("company identity selects a supported active listing on the primary exchange", () => {
  const company = buildCompanyResearch("AMD", [
    { symbol: "AMD", name: "Inactive", active: false, predictionSupported: true, exchangePriority: 200 },
    { symbol: "AMD", name: "Other listing", active: true, predictionSupported: true, exchangePriority: 50 },
    { symbol: "AMD", name: "Advanced Micro Devices", exchange: "NASDAQ", currency: "USD", active: true, predictionSupported: true, exchangePriority: 100 },
  ], fixtureGraph);
  assert.equal(company.name, "Advanced Micro Devices");
  assert.equal(company.exchange, "NASDAQ");
  assert.match(companyResearchDescription(company), /Advanced Micro Devices \(AMD\)/);
});

test("research preserves incoming supplier direction and filing evidence", () => {
  const company = buildCompanyResearch("AMD", [], fixtureGraph);
  const supplier = company.connections.find((item) => item.label === "Example Packaging supplies AMD");
  assert.ok(supplier);
  assert.equal(supplier.related.name, "Example Packaging");
  assert.ok(supplier.evidence[0].filingUrl.startsWith("https://www.sec.gov/Archives/"));
  assert.ok(!company.connections.some((item) => item.label === "AMD supplies Example Packaging"));
});

test("missing data does not invent business facts or relationships", () => {
  const company = buildCompanyResearch("UNKNOWN", [], null);
  assert.equal(company.known, false);
  assert.equal(company.name, "UNKNOWN");
  assert.equal(company.exchange, null);
  assert.deepEqual(company.connections, []);
  assert.equal(buildCompanyResearch("AMD", [], null).name, "AMD");
});

test("company identity, evidence and crawlable links are present without browser JavaScript", async () => {
  // This test checks server HTML; the browser suite exercises the real styles.
  const require = createRequire(import.meta.url);
  const previous = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const { CompanyResearchOverview, AuthProvider } = await (async () => {
    try {
      // Use the same CommonJS loader as tsx's internal component imports so the
      // provider and consumer share a context on both Node 20 and Node 24.
      const { CompanyResearchOverview } = require("../../src/components/company-research-overview") as typeof import("../../src/components/company-research-overview");
      const { AuthProvider } = require("../../src/components/providers/auth-provider") as typeof import("../../src/components/providers/auth-provider");
      return { CompanyResearchOverview, AuthProvider };
    } finally {
      if (previous) require.extensions[".css"] = previous;
      else delete require.extensions[".css"];
    }
  })();
  const company = buildCompanyResearch("AMD", [], fixtureGraph);
  const html = renderToStaticMarkup(<AuthProvider><CompanyResearchOverview company={company} /></AuthProvider>);
  assert.match(html, /<h1[^>]*>Advanced Micro Devices/);
  assert.match(html, /Example Packaging supplies AMD/);
  assert.match(html, /Synthetic test evidence/);
  assert.match(html, /href="\/ticker\/NVDA"/);
  assert.match(html, /href="https:\/\/www.sec.gov\/Archives\//);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /Loading ticker/);
});

 test("company headings and descriptions use the requested language", async () => {
  const { CompanyHeading } = await import("../../src/components/company-heading");
  const { LocaleProvider } = await import("../../src/components/providers/locale-provider");
  const company = buildCompanyResearch("AMD", [{symbol:"AMD",active:true,predictionSupported:true,name:"Advanced Micro Devices",names:{en:"AMD","zh-CN":"超威半导体"}}],fixtureGraph);
  const en = renderToStaticMarkup(<LocaleProvider locale="en"><CompanyHeading {...company} /></LocaleProvider>);
  const zh = renderToStaticMarkup(<LocaleProvider locale="zh-CN"><CompanyHeading {...company} /></LocaleProvider>);
  assert.match(en, />AMD<\/h1>/);
  assert.match(zh, /超威半导体/);
  assert.match(companyResearchDescription(company,"zh-CN"), /研究超威半导体/);
  assert.match(companyResearchDescription(company,"en"), /Research AMD/);
 });
 test("Chinese company normalization retains localized identity and descriptions", async () => {
  const { normalizeChinaCompany } = await import("../../src/lib/industry-research/china");
  const { companyName } = await import("../../src/lib/knowledge-graph/model");
  const company = normalizeChinaCompany({id:"XSHE:002156",name:"通富微电",names:{en:"Tongfu Microelectronics","zh-CN":"通富微电"},stage:"封装",description:"公司介绍",descriptionEn:"Chip packaging",source:"https://example.com",sourceLabel:"报告"})!;
  assert.equal(companyName(company,"en"),"Tongfu Microelectronics");
  assert.equal(companyName(company,"zh-CN"),"通富微电");
  assert.equal(company.descriptionEn,"Chip packaging");
 });
