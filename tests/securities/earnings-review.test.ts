import assert from "node:assert/strict";
import test from "node:test";
import { captureEarningsDocument, htmlToEarningsText } from "../../src/lib/earnings/document";
import { extractEarnings, type ExtractionPlan, type MetricRule } from "../../src/lib/earnings/extract";
import type { EarningsSource, ExtractionOutcome, Period, ForecastPeriod } from "../../src/lib/earnings/model";

// Synthetic, tiny shape-only documents. These are not issuer downloads and do
// not establish real-document coverage. Numeric examples mirror reviewed facts
// where useful; source URLs test attribution/allowlists, not document authenticity.
const now = "2026-10-01T13:59:00Z";
const amdUrl = "https://ir.amd.com/news-events/press-releases/detail/1295/amd-reports-second-quarter-2026-financial-results";
const msftUrl = "https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast";
const msftCallUrl = "https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q4";
const q2: Period = { start: "2026-03-29", end: "2026-06-27", type: "quarter", fiscalYear: 2026, fiscalQuarter: 2 };
const q3Label: ForecastPeriod = {start:null,end:null,type:"quarter",fiscalYear:2026,fiscalQuarter:3};
const q3: Period = { start: "2026-06-28", end: "2026-09-26", type: "quarter", fiscalYear: 2026, fiscalQuarter: 3 };

function source(overrides: Partial<EarningsSource> = {}): EarningsSource {
  return {
    provider: "issuer_ir", companyId: "US:AMD", issuerId: "sec:0000002488",
    documentId: "synthetic-review-fixture", url: amdUrl,
    title: "AMD Reports Second Quarter 2026 Financial Results",
    publishedAt: { value: "2026-08-04", precision: "date", timezone: null },
    firstSeenAt: now, language: "en", ...overrides,
  };
}

function document(body: string, options: {
  source?: EarningsSource; html?: boolean; completeness?: "full" | "excerpt";
} = {}) {
  return captureEarningsDocument(options.source ?? source(), Buffer.from(body), {
    mediaType: options.html ? "text/html" : "text/plain", retrievedAt: now,
    completeness: options.completeness ?? "excerpt",
  });
}

const body = [
  "AMD synthetic shape-only example",
  "Actual results",
  "Q2 fiscal 2026, three months ended June 27, 2026",
  "USD millions",
  "Consolidated revenue 11,536",
  "Gaming revenue decreased by 31 %",
  "Outlook for the third quarter of 2026",
  "Guidance revenue approximately $13 billion, plus or minus $300 million",
].join("\n");

function actual(overrides: Partial<MetricRule> = {}): MetricRule {
  return {
    name: "revenue", label: "Consolidated revenue", rowLabel: "Consolidated revenue",
    unitEvidence: "USD millions", currency: "USD", scale: 1e6, unit: "currency",
    kind: "actual", basis: "US_GAAP", scope: "consolidated", ...overrides,
  };
}

function guidance(overrides: Partial<MetricRule> = {}): MetricRule {
  return {
    name: "revenue", label: "Revenue outlook", rowLabel: "Guidance revenue",
    unitEvidence: "$13 billion", currency: "USD", scale: 1e9, unit: "currency",
    kind: "forecast", basis: "unspecified", scope: "consolidated",
    period: q3Label, periodEvidence: ["Outlook for the third quarter of 2026"],
    range: true, rangeMode: "plus_minus_absolute", toleranceScale: 1e6,
    toleranceUnitEvidence: "$300 million", approximate: true, ...overrides,
  };
}

function plan(metrics: MetricRule[] = [actual()], overrides: Partial<ExtractionPlan> = {}): ExtractionPlan {
  return { period: q2, periodEvidence: ["Q2 fiscal 2026", "June 27, 2026"], kind: "actual", metrics, ...overrides };
}

function extracted(result: ExtractionOutcome) {
  assert.equal(result.status, "extracted", result.status === "extracted" ? undefined : result.reason);
  if (result.status !== "extracted") throw new Error("Expected extracted result");
  return result.record;
}

function rejected(result: ExtractionOutcome, pattern: RegExp) {
  assert.equal(result.status, "review_required");
  if (result.status !== "review_required") throw new Error("Expected review_required result");
  assert.match(result.reason, pattern);
}

test("earnings review: HTML cell newlines cannot erase the real table-row shape", () => {
  const html = `<html><body><h1>AMD synthetic shape-only example</h1>
    <p>Q2 fiscal 2026, three months ended June 27, 2026</p><p>USD millions</p>
    <table><tr><td>Consolidated revenue</td>
      <td>\n 11,536 \n</td><td>\n 7,685 \n</td><td>Up 50%</td></tr></table></body></html>`;
  const text = htmlToEarningsText(html);
  assert.match(text, /Consolidated revenue\s*\|\s*11,536\s*\|\s*7,685/);
  const record = extracted(extractEarnings(document(html, { html: true }), plan(), now));
  assert.equal(record.metrics[0].value, 11_536_000_000);
  assert.match(record.metrics[0].evidence.find(e => e.text.startsWith("Consolidated revenue"))!.text, /7,685/);
});

test("earnings review: default endpoints reject midpoint-plus-minus mixed units", () => {
  rejected(extractEarnings(document(body), plan([actual(), guidance({ rangeMode: "endpoints" })]), now), /explicit tolerance transform/);
});

test("earnings review: explicit mixed-unit tolerance preserves point and derived band", () => {
  const record = extracted(extractEarnings(document(body), plan([actual(), guidance()]), now));
  const forecast = record.metrics[1];
  assert.equal(forecast.value, null);
  assert.equal(forecast.point, 13_000_000_000);
  assert.equal(forecast.low, 12_700_000_000);
  assert.equal(forecast.high, 13_300_000_000);
  assert.equal(forecast.derivation, "midpoint_plus_minus");
  assert.equal(forecast.approximate, true);
  assert.deepEqual(forecast.period, q3Label);
});

test("earnings review: wrong tolerance scale fails closed", () => {
  rejected(extractEarnings(document(body), plan([actual(), guidance({ toleranceScale: 1e9 })]), now), /tolerance unit mismatch/);
});

test("earnings review: percent tolerance handles a spaced percent sign", () => {
  const percentBody = body.replace("$13 billion, plus or minus $300 million", "$91.0 billion, plus or minus 2 %");
  const rule = guidance({ unitEvidence: "$91.0 billion", rangeMode: "plus_minus_percent", toleranceScale: undefined, toleranceUnitEvidence: undefined });
  const forecast = extracted(extractEarnings(document(percentBody), plan([actual(), rule]), now)).metrics[1];
  assert.equal(forecast.point, 91_000_000_000);
  assert.equal(forecast.low, 89_180_000_000);
  assert.equal(forecast.high, 92_820_000_000);
});

test("earnings review: verbal declines and spaced percent signs retain the negative sign", () => {
  const rule: MetricRule = {
    name: "revenue_yoy", label: "Gaming growth", rowLabel: "Gaming revenue",
    currency: null, unit: "percent", scale: 1, kind: "actual", basis: "US_GAAP",
    scope: "segment_business", segment: "Gaming",
  };
  for (const direction of ["decreased by", "down"]) {
    const record = extracted(extractEarnings(document(body.replace("decreased by", direction)), plan([actual(), rule]), now));
    assert.equal(record.metrics[1].value, -31);
  }
});

test("earnings review: forecast cannot inherit the actual release quarter", () => {
  rejected(extractEarnings(document(body), plan([actual(), guidance({ period: undefined, periodEvidence: undefined })]), now), /forecast|guidance|period/i);
});

test("earnings review: a separately labelled guidance period needs literal evidence", () => {
  rejected(extractEarnings(document(body), plan([actual(), guidance({ periodEvidence: [] })]), now), /period.*evidence/i);
});

test("earnings review: actual results cannot be relabelled as a future source period", () => {
  rejected(extractEarnings(document(body), plan([actual()], { period: q3 }), now), /future period|Fiscal year\/quarter conflicts/);
});

test("earnings review: guidance target cannot be emitted as an actual observation", () => {
  rejected(extractEarnings(document(body), plan([actual(), guidance({ kind: "actual", range: false, period: q3 })]), now), /Actual metric period differs/);
});

test("earnings review: a forecast document cannot emit actual results", () => {
  const forecastSource = source({ title: "AMD Raises Revenue Guidance" });
  rejected(extractEarnings(document(body, { source: forecastSource }), plan([actual()], { kind: "forecast" }), now), /Forecast document cannot emit actual/);
});

test("earnings review: quarter duration and literal period evidence are mandatory", () => {
  const halfYearMislabelledQuarter: Period = { start: "2026-01-01", end: "2026-06-30", type: "quarter", fiscalYear: 2026, fiscalQuarter: 2 };
  rejected(extractEarnings(document(body), plan([actual()], { period: halfYearMislabelledQuarter }), now), /duration/);
  rejected(extractEarnings(document(body), plan([actual()], { periodEvidence: [] }), now), /Fiscal period needs source evidence/);
  const quarterMislabelledYtd: Period = { ...q2, type: "half_year", fiscalQuarter: undefined };
  rejected(extractEarnings(document(body), plan([actual()], { period: quarterMislabelledYtd }), now), /duration/);
});

test("earnings review: one full raw source cannot attribute its evidence to another URL", () => {
  const alternate = "https://ir.amd.com/news-events/press-releases/detail/1284/amd-reports-first-quarter-2026-financial-results";
  rejected(extractEarnings(document(body, { completeness: "full" }), plan([actual({ sourceUrl: alternate })]), now), /Full raw document cannot evidence another source/);
});

test("earnings review: curated composite keeps Microsoft guidance attached to its call source", () => {
  const composite = [
    "Microsoft synthetic composite excerpt",
    "Q4 fiscal 2026, three months ended June 30, 2026",
    "USD millions",
    "Consolidated revenue 90,007",
    "Outlook for the first quarter of fiscal 2027",
    "Guidance revenue between $89.85 and $90.95 billion",
  ].join("\n");
  const msftSource = source({ companyId: "US:MSFT", issuerId: "sec:0000789019", url: msftUrl,
    title: "Microsoft Quarterly Results", publishedAt: { value: "2026-07-29", precision: "date", timezone: null } });
  const actualPeriod: Period = { start: "2026-04-01", end: "2026-06-30", type: "quarter", fiscalYear: 2026, fiscalQuarter: 4 };
  const targetPeriod: ForecastPeriod = { start: null, end: null, type: "quarter", fiscalYear: 2027, fiscalQuarter: 1 };
  const rule = guidance({ sourceUrl: msftCallUrl, rangeMode: "endpoints", unitEvidence: "$90.95 billion",
    period: targetPeriod, periodEvidence: ["Outlook for the first quarter of fiscal 2027"] });
  const msftPlan = plan([actual(), rule], { period: actualPeriod, periodEvidence: ["Q4 fiscal 2026", "June 30, 2026"] });
  const record = extracted(extractEarnings(document(composite, { source: msftSource }), msftPlan, now));
  assert.equal(record.completeness, "excerpt");
  assert.equal(record.metrics[0].sourceUrl, msftUrl);
  assert.equal(record.metrics[1].sourceUrl, msftCallUrl);
  assert.equal(record.metrics[1].sourceEvidenceKind, "curated_factual_excerpt");
  assert.equal(record.metrics[1].low, 89_850_000_000);
  assert.equal(record.metrics[1].high, 90_950_000_000);
  assert.ok(record.metrics[1].evidence.every(e => e.sourceUrl === msftCallUrl));
  assert.ok(record.warnings.includes("excerpt_not_full_document_coverage"));
});

test("earnings review: announcement dates must equal the cited date, not merely exist beside it", () => {
  const doc = document(body + '\nPublished August 4, 2026');
  rejected(extractEarnings(doc, plan([actual()], { announcementDate:'2026-01-01', announcementDateEvidence:'August 4, 2026' }), now), /Announcement date conflicts/);
  assert.equal(extracted(extractEarnings(doc, plan([actual()], { announcementDate:'2026-08-04', announcementDateEvidence:'August 4, 2026' }), now)).announcementDate, '2026-08-04');
});
test("earnings review: English fiscal labels cannot contradict the actual heading", () => {
  rejected(extractEarnings(document(body), plan([actual()], { period:{...q2,fiscalYear:2025,fiscalQuarter:3} }), now), /Fiscal year\/quarter conflicts/);
});

test("earnings review: valid-length half-year cannot replace a US quarterly observation",()=>{
  rejected(extractEarnings(document(body),plan([actual()],{period:{start:"2025-12-28",end:"2026-06-27",type:"half_year",fiscalYear:2026}}),now),/quarter-specific adapter/);
});
test("earnings review: guidance fiscal label must agree with cited target",()=>{
  rejected(extractEarnings(document(body),plan([actual(),guidance({period:{...q3Label,fiscalYear:2099}})]),now),/Guidance fiscal target conflicts/);
  rejected(extractEarnings(document(body),plan([actual(),guidance({period:q3})]),now),/Guidance dates require explicit/);
});
