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
      const { CompanyResearchOverview } = await import("../../src/components/company-research-overview");
      const { AuthProvider } = await import("../../src/components/providers/auth-provider");
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
