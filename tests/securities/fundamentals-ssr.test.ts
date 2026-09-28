import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompanyFundamentals } from "../../src/lib/fundamentals/model";

const require = createRequire(import.meta.url);
const { CompanyFundamentalsLive } = require("../../src/components/company-fundamentals-live") as typeof import("../../src/components/company-fundamentals-live");

test("live refresh wrapper preserves cached financials and filing links in crawlable HTML", () => {
  const initialData: CompanyFundamentals = {
    fetchedAt: "2026-09-28T00:00:00.000Z", stale: true, excerpt: "Business description from the annual filing.",
    report: { cik: "2488", accession: "0000002488-26-000010", form: "10-K", end: "2025-12-31", filed: "2026-02-01", url: "https://www.sec.gov/Archives/example.htm" },
    metrics: [{ label: "Revenue", value: 12_000_000_000, unit: "USD", start: "2025-01-01", end: "2025-12-31", filed: "2026-02-01", sourceUrl: "https://www.sec.gov/Archives/example.htm", tag: "us-gaap:Revenues" }],
  };
  const html = renderToStaticMarkup(createElement(CompanyFundamentalsLive, { ticker: "AMD", initialData }));
  assert.match(html, /12B USD/);
  assert.match(html, /Business description from the annual filing/);
  assert.match(html, /href="https:\/\/www.sec.gov\/Archives\/example.htm"/);
  assert.match(html, /previously fetched snapshot/);
  const empty = renderToStaticMarkup(createElement(CompanyFundamentalsLive, { ticker: "AMD", initialData: null }));
  assert.match(empty, /Missing data is requested in the background/);
});
