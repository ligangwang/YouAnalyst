import test from "node:test";
import assert from "node:assert/strict";
import { matchCompany, companyGeography, companyGeographyLabel, type CompanyIdentity } from "../src/lib/market-companies/identity";
import { graphFromMarket, type MarketCompany } from "../src/lib/knowledge-graph/market-store";
import { filterGraph } from "../src/lib/knowledge-graph/model";
import { companyPageUrl } from "../src/lib/market-companies/routes";
const nvidia: CompanyIdentity = { id: "US:NVDA", name: "NVIDIA", country: "US", identifiers: [{ scheme: "CIK", value: "1045810" }], listings: [{ market: "US", exchange: "XNAS", symbol: "NVDA" }] };
test("reuses issuer across proposal IDs and blocks conflicting identities", () => {
  assert.deepEqual(matchCompany({ ...nvidia, id: "ORG:NVIDIA" }, [nvidia]).ids, ["US:NVDA"]);
  assert.equal(matchCompany({ id: "ORG:NVIDIA", name: "NVIDIA", identifiers: [{ scheme: "CIK", value: "0001045810" }] }, [nvidia]).status, "EXISTING");
  assert.equal(matchCompany({ ...nvidia, country: "CN" }, [nvidia]).status, "REVIEW");
  assert.equal(matchCompany({ ...nvidia, name: "Unrelated company" }, [nvidia]).status, "REVIEW");
  assert.equal(matchCompany({ ...nvidia, website: "https://unrelated.example" }, [{ ...nvidia, website: "https://nvidia.com" }]).status, "REVIEW");
  assert.equal(matchCompany({ ...nvidia, name: "Old name" }, [{ ...nvidia, aliases: ["Old name"] }]).status, "EXISTING");
  assert.equal(matchCompany({ ...nvidia, identifiers: [{ scheme: "CIK", value: "999" }] }, [nvidia]).status, "REVIEW");
  assert.equal(matchCompany(nvidia, [nvidia, { ...nvidia, id: "OTHER:NVDA" }]).status, "REVIEW");
});
test("global private neighbors render with their own identity and profile route", () => {
  const seed = { id: "US:NVDA", name: "NVIDIA", status: "DIRECTORY", aiGraph: { status: "PUBLISHED", stageIds: [], stages: [], sources: [], memberships: [], order: 1, asOf: "2026-09-13" } } as MarketCompany;
  const graph = graphFromMarket([seed, { id: "ORG:LAB", name: "Independent lab", status: "PUBLISHED", country: "FR", listingStatus: "PRIVATE" }], [{ id: "r", source: "US:NVDA", target: "ORG:LAB", type: "PARTNER_OF", status: "PUBLISHED", evidence: [{ id: "s", url: "https://example.com/announcement", title: "Announcement", sourceDate: null }] }]);
  const lab = graph.nodes.find(n => n.id === "ORG:LAB")!;
  assert.equal(lab.market, "GLOBAL");
  assert.equal(lab.country, "FR");
  assert.equal(lab.listingStatus, "PRIVATE");
  assert.equal(filterGraph(graph, ["CN_A"]).nodes.length, 0);
  assert.equal(filterGraph(graph, ["GLOBAL"]).nodes.filter(n => n.kind === "COMPANY").length, 1);
  assert.equal(companyPageUrl(lab.id, lab.market), "/company/ORG%3ALAB");
  assert.equal(companyPageUrl("NVDA", "US"), "/ticker/NVDA");
});
test("shared names and websites do not merge subsidiaries or unrelated issuers", () => {
  assert.equal(matchCompany({ id: "ORG:NEW", name: " NVIDIA " }, [nvidia]).status, "REVIEW");
  assert.equal(matchCompany({ id: "ORG:NEW", name: "Subsidiary", website: "https://www.example.com/sub" }, [{ id: "ORG:PARENT", name: "Parent", website: "https://example.com" }]).status, "REVIEW");
  assert.equal(matchCompany({ id: "ORG:NEW", name: "New business" }, [nvidia]).status, "NEW");
});
test("country is not inferred from listing market; private status remains distinct from publication", () => {
  assert.deepEqual(companyGeography({ market: "US", status: "PUBLISHED" }), { listingStatus: "UNKNOWN", listings: [] });
  const data = companyGeography({ country: "CN", listingStatus: "PRIVATE", listings: [null, {}] });
  assert.deepEqual(data, { country: "CN", listingStatus: "PRIVATE", listings: [] });
  assert.match(companyGeographyLabel(data, "en"), /China · Private/);
  assert.match(companyGeographyLabel(data, "zh-CN"), /中国 · 非上市公司/);
});
