import { test } from "node:test";
import assert from "node:assert/strict";
import { annualMetrics, businessExcerpt, latestAnnualReport, type AnnualReport, type CompanyFacts } from "../../src/lib/fundamentals/model";

const report: AnnualReport = { cik: "0000002488", accession: "0000002488-26-000010", form: "10-K", filed: "2026-02-01", end: "2025-12-27", url: "https://www.sec.gov/Archives/example.htm" };
const annual = { val: 100, start: "2024-12-29", end: report.end, filed: report.filed, accn: report.accession, form: "10-K" };
const facts = (units: Record<string, Array<Partial<typeof annual>>>): CompanyFacts => ({ cik: 2488, facts: { "us-gaap": { Revenues: { units } } } });

test("annual metrics exclude quarter, YTD, wrong year, wrong form and nonfinite values", () => {
  const input = facts({ USD: [annual,
    { ...annual, val: 999, start: "2025-10-01" },
    { ...annual, val: 999, start: "2025-04-01" },
    { ...annual, val: 999, end: "2024-12-28" },
    { ...annual, val: 999, form: "10-Q", filed: "2026-05-01" },
    { ...annual, val: Infinity },
  ] });
  const result = annualMetrics(input, report);
  assert.equal(result.length, 6);
  assert.equal(result[0].value, 100);
  assert.equal(result[0].start, annual.start);
  assert.equal(result[1].value, null);
});

test("latest restatement replaces the value and retains its own filing source", () => {
  const amendment = { ...annual, val: 95, filed: "2026-03-01", form: "10-K/A", accn: "0000002488-26-000011" };
  const [metric] = annualMetrics(facts({ USD: [amendment, annual] }), report);
  assert.equal(metric.value, 95);
  assert.equal(metric.filed, amendment.filed);
  assert.match(metric.sourceUrl!, /0000002488-26-000011-index\.html$/);
});

test("ambiguous currencies or duplicate conflicting values fail closed", () => {
  assert.equal(annualMetrics(facts({ USD: [annual], CAD: [annual] }), report)[0].value, null);
  assert.equal(annualMetrics(facts({ USD: [annual, { ...annual, val: 90 }] }), report)[0].value, null);
  assert.equal(annualMetrics(facts({ USD: [annual, annual] }), report)[0].value, 100);
});

test("zero and negative values remain valid, while issuer mismatch is rejected", () => {
  assert.equal(annualMetrics(facts({ USD: [{ ...annual, val: 0 }] }), report)[0].value, 0);
  assert.equal(annualMetrics(facts({ USD: [{ ...annual, val: -4 }] }), report)[0].value, -4);
  assert.ok(annualMetrics({ ...facts({ USD: [annual] }), cik: 123 }, report).every(metric => metric.value === null));
});

test("instant facts and per-share units do not mix with annual dollar flows", () => {
  const input: CompanyFacts = { cik: 2488, facts: { "us-gaap": {
    Assets: { units: { USD: [{ ...annual, start: undefined, val: 200 }, { ...annual, val: 999 }] } },
    EarningsPerShareDiluted: { units: { "USD/shares": [{ ...annual, val: 1.25 }], USD: [{ ...annual, val: 999 }] } },
  } } };
  const metrics = annualMetrics(input, report);
  assert.equal(metrics[2].value, 1.25);
  assert.equal(metrics[2].unit, "USD/shares");
  assert.equal(metrics[5].value, 200);
  assert.equal(metrics[5].start, null);
});

test("IFRS annual facts retain their reported currency", () => {
  const metrics = annualMetrics({ cik: 2488, facts: { "ifrs-full": { Revenue: { units: { TWD: [{ ...annual, form: "20-F" }] } } } } }, { ...report, form: "20-F" });
  assert.equal(metrics[0].value, 100);
  assert.equal(metrics[0].unit, "TWD");
});

test("latest annual report skips amendments and rejects unsafe source paths", () => {
  const input = { filings: { recent: {
    form: ["10-K/A", "10-K", "10-K"], accessionNumber: [report.accession, report.accession, report.accession],
    filingDate: ["2026-03-01", report.filed, "2026-04-01"], reportDate: [report.end, report.end, "2026-01-01"],
    primaryDocument: ["amendment.htm", "annual.htm", "../../bad.htm"],
  } } };
  assert.equal(latestAnnualReport(report.cik, input)?.url, "https://www.sec.gov/Archives/edgar/data/2488/000000248826000010/annual.htm");
});

test("business excerpt skips headings and forward-looking notices and marks truncation", () => {
  const paragraph = "We design and sell semiconductor products for computing and graphics applications. Our customers include manufacturers of personal computers, servers and embedded systems around the world.";
  assert.equal(businessExcerpt(`Item 1. Business\nOverview\n${paragraph}`), paragraph);
  assert.equal(businessExcerpt(`Item 1. Business\n${"Additionally, voluntary disclosures about our products may be subject to methodological considerations. ".repeat(3)}\nOverview\n${paragraph}`), paragraph);
  assert.equal(businessExcerpt("Item 1. Business\nTable of contents"), null);
  assert.ok(businessExcerpt("Our company manufactures computing products and related systems for customers. ".repeat(20))!.length <= 701);
});
