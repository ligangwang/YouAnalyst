import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { captureEarningsDocument } from "../../src/lib/earnings/document";
import { extractEarnings } from "../../src/lib/earnings/extract";
import { makeUsEarningsPlan } from "../../src/lib/earnings/live-us";
import { earningsPilot } from "../../src/lib/earnings/pilot";
import type { EarningsSource, RawEarningsDocument } from "../../src/lib/earnings/model";

const now = "2026-10-02T11:00:00Z";
const fixtures = resolve("tests/fixtures/earnings/live-us");
const examples = {
  nvidia: { companyId: "US:NVDA", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm", revenue: 96_221e6, yoy: 106, start: "2026-04-27", end: "2026-07-26", fy: 2027, q: 2, currency: "USD" },
  amd: { companyId: "US:AMD", url: "https://www.sec.gov/Archives/edgar/data/2488/000000248826000121/q22026991.htm", revenue: 11_536e6, yoy: 50, start: "2026-03-29", end: "2026-06-27", fy: 2026, q: 2, currency: "USD" },
  microsoft: { companyId: "US:MSFT", url: "https://www.sec.gov/Archives/edgar/data/789019/000119312526323632/msft-ex99_1.htm", revenue: 90_007e6, yoy: 18, start: "2026-04-01", end: "2026-06-30", fy: 2026, q: 4, currency: "USD" },
  alibaba: { companyId: "US:BABA", url: "https://www.sec.gov/Archives/edgar/data/1577552/000110465926099220/tm2623667d1_ex99-1.htm", revenue: 268_953e6, yoy: 9, start: "2026-04-01", end: "2026-06-30", fy: 2027, q: 1, currency: "CNY" },
};
type Example = keyof typeof examples;
function body(name: Example) { return readFileSync(resolve(fixtures, `${name}.html`), "utf8"); }
function document(name: Example, html = body(name), overrides: Partial<EarningsSource> = {}) {
  const example = examples[name], company = earningsPilot.find(value => value.companyId === example.companyId)!;
  return captureEarningsDocument({ provider: "sec", companyId: company.companyId, issuerId: company.issuerId,
    documentId: `authored-live-us-${name}`, url: example.url, title: "EX-99.1", publishedAt: null,
    firstSeenAt: now, filingDate: "2026-08-26", language: "en", ...overrides }, Buffer.from(html),
  { mediaType: "text/html", retrievedAt: now, completeness: "excerpt" });
}
function record(doc: RawEarningsDocument) {
  const plan = makeUsEarningsPlan(doc); assert.ok(plan, "Expected a supported factual shape");
  const outcome = extractEarnings(doc, plan, now);
  if (outcome.status !== "extracted") assert.fail(outcome.reason);
  return outcome.record;
}
for (const [name, expected] of Object.entries(examples) as [Example, typeof examples[Example]][]) {
  test(`live US ${name}: literal period, precise quarterly native revenue and reported growth`, () => {
    const doc = document(name), result = record(doc);
    assert.deepEqual(result.period, { start: expected.start, end: expected.end, type: "quarter", fiscalYear: expected.fy, fiscalQuarter: expected.q });
    assert.equal(result.metrics.find(metric => metric.name === "revenue")!.value, expected.revenue);
    assert.equal(result.metrics.find(metric => metric.name === "revenue")!.currency, expected.currency);
    assert.equal(result.metrics.find(metric => metric.name === "revenue_yoy")!.value, expected.yoy);
    assert.equal(result.coverage.segments, "not_extracted"); assert.equal(result.coverage.guidance, "not_extracted");
    assert.equal(result.completeness, "excerpt"); assert.match(result.parserVersion, name === "alibaba" ? /us-live-2/ : /us-live-1/);
    assert.ok(result.metrics.every(metric => metric.evidence.every(evidence => doc.text.slice(evidence.start, evidence.end) === evidence.text && evidence.sourceUrl === doc.source.url)));
  });
}

const bylines: Record<Example, { text: string; date: string }> = {
  nvidia: { text: "SANTA CLARA, Calif.—Aug. 26, 2026― NVIDIA", date: "2026-08-26" },
  amd: { text: "SANTA CLARA, Calif., Aug. 04, 2026 (GLOBE NEWSWIRE) -- AMD", date: "2026-08-04" },
  microsoft: { text: "REDMOND, Wash. — July 29, 2026 — Microsoft Corp.", date: "2026-07-29" },
  alibaba: { text: "Hong Kong, China, August 20,<br>2026 - Alibaba Group Holding Limited", date: "2026-08-20" },
};
for (const [name, byline] of Object.entries(bylines) as [Example, typeof bylines[Example]][]) {
  test(`live US ${name}: unique literal byline date is separate from filing/publication times`, () => {
    const doc = document(name, body(name).replace("</h1>", `</h1><p>${byline.text}</p>`), {
      publishedAt: { value: "2026-08-27", precision: "date", timezone: null },
      filingDate: "2026-08-27", filingAcceptedAt: "2026-08-27T16:21:19Z",
    });
    const result = record(doc);
    assert.equal(result.announcementDate, byline.date);
    const evidence = result.announcementDateEvidence!; assert.ok(evidence);
    assert.equal(doc.text.slice(evidence.start, evidence.end), evidence.text);
    assert.deepEqual(result.source.publishedAt, doc.source.publishedAt);
    assert.equal(result.source.filingAcceptedAt, doc.source.filingAcceptedAt);
    assert.notEqual(result.announcementDate, result.period.end);
    assert.notEqual(result.announcementDate, result.source.filingDate);
    assert.equal(record(document(name)).announcementDate, null);
  });
}
test("live US missing, invalid, ambiguous, or wrong-issuer bylines leave announcement date unavailable", () => {
  const byline = `<p>${bylines.amd.text}</p>`;
  const invalid = [
    byline + byline,
    byline + byline.replace("Aug. 04", "Aug. 05"),
    byline.replace("Aug. 04", "September 31"),
    byline.replace("2026", "2027"),
    byline.replace("Aug. 04", "May 04"),
    byline.replace("-- AMD", "-- NVIDIA"),
    "<p>August 4, 2026</p>",
  ];
  for (const html of invalid) {
    const result = record(document("amd", body("amd").replace("</h1>", `</h1>${html}`)));
    assert.equal(result.announcementDate, null, html);
    assert.equal(result.announcementDateEvidence, null, html);
  }
});

test("live US unknown title is insufficient without a supported release and issuer", () => {
  assert.equal(makeUsEarningsPlan(document("amd", "<p>AMD 8-K other corporate news</p>")), null);
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replaceAll("AMD", "Other Company"))), null);
  assert.equal(makeUsEarningsPlan({ ...document("amd"), source: { ...document("amd").source, companyId: "US:OTHER" } }), null);
});
test("live US rejects unapproved URLs, wrong issuer, and altered raw text integrity", () => {
  const doc = document("amd");
  for (const source of [{ ...doc.source, url: "https://untrusted.example/release" }, { ...doc.source, issuerId: "sec:0001045810" }]) {
    assert.equal(makeUsEarningsPlan({ ...doc, source }), null);
  }
  assert.equal(makeUsEarningsPlan({ ...doc, text: doc.text.replace("11,536", "99,000") }), null);
});
test("live US separates preliminary, forecast, and scheduled-release documents", () => {
  for (const title of ["AMD Preliminary Financial Results", "AMD Raises Revenue Guidance", "AMD to Report Financial Results"]) {
    assert.equal(makeUsEarningsPlan(document("amd", body("amd"), { title })), null);
  }
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replace("AMD Second", "AMD Preliminary Financial Results Second"))), null);
});
test("live US rejects duplicate consolidated rows and duplicate actual sections", () => {
  const html = body("amd"), revenue = /<tr><td>Revenue \(\$M\)<\/td>[^]*?<\/tr>/.exec(html)![0];
  assert.equal(makeUsEarningsPlan(document("amd", html.replace(revenue, revenue + revenue))), null);
  assert.equal(makeUsEarningsPlan(document("amd", html + html)), null);
});
test("live US rejects changed year/quarter or growth column order", () => {
  assert.equal(makeUsEarningsPlan(document("nvidia", body("nvidia").replace("Q2 FY27", "Q1 FY27"))), null);
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replace("<th>Y/Y (1)</th>", "<th>Q/Q</th>"))), null);
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replace("Q2'25 (1)", "Q2'24 (1)"))), null);
});
test("live US requires literal prior quarter end rather than subtracting 90 days", () => {
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replace("March 28, 2026", "December 27, 2025"))), null);
  assert.equal(makeUsEarningsPlan(document("nvidia", body("nvidia").replace("April 26,", "January 25,"))), null);
});
test("live US rejects missing or contradictory scale, currency, and future periods", () => {
  assert.equal(makeUsEarningsPlan(document("nvidia", body("nvidia").replace("$ in millions", "$ in billions"))), null);
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replace("$11,536", "HK$11,536"))), null);
  assert.equal(makeUsEarningsPlan(document("amd", body("amd").replace("Millions except", "Billions except") + "<p>(Millions except per share amounts and percentages)</p>")), null);
  assert.equal(makeUsEarningsPlan(document("amd", body("amd"), { filingDate: "2026-01-01" })), null);
});
test("live US Microsoft keeps reported YoY distinct from constant currency and annual revenue", () => {
  const result = record(document("microsoft"));
  assert.equal(result.metrics[0].value, 90_007e6); assert.equal(result.metrics[1].value, 18);
  const html = body("microsoft").replace("Three Months Ended June 30,", "Twelve Months Ended June 30,").replace("<th>Twelve Months Ended June 30,</th></tr>", "<th>Three Months Ended June 30,</th></tr>");
  assert.equal(makeUsEarningsPlan(document("microsoft", html)), null);
  assert.equal(makeUsEarningsPlan(document("microsoft", body("microsoft").replace("90,007", "331,839"))), null);
});
test("live US Alibaba rejects reversed current/prior or native/convenience currency columns", () => {
  assert.equal(makeUsEarningsPlan(document("alibaba", body("alibaba").replace("<td>2025</td><td>2026</td>", "<td>2026</td><td>2025</td>"))), null);
  assert.equal(makeUsEarningsPlan(document("alibaba", body("alibaba").replace("<td>RMB</td><td>RMB</td><td>US$</td>", "<td>RMB</td><td>US$</td><td>RMB</td>"))), null);
});
const alibabaAnnouncementHtml = () => readFileSync(resolve(fixtures, "alibaba-sec-announcement.html"), "utf8");
function alibabaAnnouncement(html = alibabaAnnouncementHtml()) {
  return document("alibaba", html, {
    url: "https://www.sec.gov/Archives/edgar/data/1577552/000110465926060224/tm2614494d1_ex99-1.htm",
    documentId: "0001104659-26-060224/tm2614494d1_ex99-1.htm", filingDate: "2026-05-13",
    form: "6-K", accession: "0001104659-26-060224",
  });
}
test("live US Alibaba formal SEC March announcement keeps quarterly revenue separate from annual results", () => {
  const doc = alibabaAnnouncement(), result = record(doc);
  const headingOffset = doc.text.replace(/\s+/g, " ").indexOf("ANNOUNCEMENT OF THE MARCH QUARTER");
  assert.ok(headingOffset >= 0 && headingOffset < 2500);
  assert.deepEqual(result.period, { start: "2026-01-01", end: "2026-03-31", type: "quarter", fiscalYear: 2026, fiscalQuarter: 4 });
  assert.equal(result.metrics[0].value, 243_380e6); assert.equal(result.metrics[0].currency, "CNY");
  assert.equal(result.metrics[1].value, 3); assert.equal(result.metrics[0].scale, 1e6);
  assert.notEqual(result.metrics[0].value, 1_023_670e6);
  assert.equal(result.announcementDate, null);
  assert.ok(result.periodEvidence.some(evidence => evidence.text.includes("ANNUAL RESULTS")));
});
test("live US Alibaba formal heading rejects changed periods, annual-only and ambiguous headlines", () => {
  const html = alibabaAnnouncementHtml();
  const heading = "ANNOUNCEMENT<br>OF THE MARCH QUARTER 2026 RESULTS AND<br>FISCAL YEAR 2026 ANNUAL RESULTS";
  const replacements = [
    heading.replace("MARCH", "JUNE"),
    heading.replace("QUARTER 2026", "QUARTER 2025"),
    heading.replace("YEAR 2026", "YEAR 2025"),
    heading.replace("QUARTER", "HALF YEAR"),
    "ANNOUNCEMENT OF FISCAL YEAR 2026 ANNUAL RESULTS",
    `${heading}</h2><h2>${heading}`,
    `${heading}</h2><h2>Alibaba Group Announces March Quarter 2026 and Fiscal Year 2026 Results`,
    `${heading}</h2><h2>ANNOUNCEMENT OF THE JUNE QUARTER 2026 RESULTS AND FISCAL YEAR 2026 ANNUAL RESULTS`,
  ];
  for (const replacement of replacements) assert.equal(makeUsEarningsPlan(alibabaAnnouncement(html.replace(heading, replacement))), null, replacement);
  assert.equal(makeUsEarningsPlan(alibabaAnnouncement(html.replace("MARCH QUARTER SUMMARY", "FISCAL YEAR SUMMARY"))), null);
});
test("live US Alibaba formal announcement retains native currency and strict column guards", () => {
  const html = alibabaAnnouncementHtml();
  assert.equal(makeUsEarningsPlan(alibabaAnnouncement(html.replace("<td>2025</td><td>2026</td>", "<td>2026</td><td>2025</td>"))), null);
  assert.equal(makeUsEarningsPlan(alibabaAnnouncement(html.replace("<td>RMB</td><td>RMB</td><td>US$</td>", "<td>RMB</td><td>US$</td><td>RMB</td>"))), null);
});

test("live US emits reported decreases with their negative sign", () => {
  const result = record(document("amd", body("amd").replace("Up 50%", "Down 5%")));
  assert.equal(result.metrics.find(metric => metric.name === "revenue_yoy")!.value, -5);
});
test("live US does not turn Flat into a fabricated numeric QoQ observation", () => {
  const result = record(document("amd", body("amd").replace("Up 13%", "Flat")));
  assert.equal(result.metrics.length, 2); assert.equal(result.metrics.some(metric => metric.name === "revenue_qoq"), false);
});
test("live US accepts another quarter in the same format without hardcoded source dates or numbers", () => {
  const html = body("amd").replaceAll("Second Quarter", "First Quarter").replaceAll("Q2'26", "Q1'26").replaceAll("Q2'25", "Q1'25")
    .replaceAll("Q1'26</th>", "Q4'25</th>")
    .replaceAll("June 27, 2026", "March 28, 2026").replaceAll("March 28, 2026</td><td>March 28, 2026", "March 28, 2026</td><td>December 27, 2025")
    .replaceAll("June 28, 2025", "March 29, 2025").replaceAll("$11,536", "$10,253").replaceAll("$7,685", "$7,438")
    .replaceAll("Up 50%", "Up 38%").replaceAll("Up 13%", "Flat");
  // Set the two distinct summary quarter columns directly after label changes.
  const fixed = html.replace("<th>Q4'25</th><th>Q1'25", "<th>Q1'26</th><th>Q1'25");
  const result = record(document("amd", fixed));
  assert.equal(result.period.fiscalQuarter, 1); assert.equal(result.period.start, "2025-12-28");
  assert.equal(result.metrics[0].value, 10_253e6); assert.equal(result.metrics[1].value, 38);
});

// Opt-in replay of actual full-source bytes; downloaded publisher documents are
// intentionally never committed. The manifest records the validated versions.
const fullSourceDirectory = process.env.EARNINGS_US_SOURCE_DIR;
test("live US actual full-source replay matches the checked provenance manifest", { skip: !fullSourceDirectory }, () => {
  const manifest = JSON.parse(readFileSync(resolve(fixtures, "provenance.json"), "utf8")) as { sources: {
    filename: string; example: Example; sha256: string; bytes: number; source: EarningsSource; announcementDate?: string | null;
    revenue: number; yoy: number; period: { start: string; end: string; fiscalYear: number; fiscalQuarter: number; type: "quarter" };
  }[] };
  for (const item of manifest.sources) {
    const bytes = readFileSync(resolve(fullSourceDirectory!, item.filename));
    const pdf = item.filename.endsWith(".pdf");
    const doc = captureEarningsDocument(item.source, bytes, { mediaType: pdf ? "application/pdf" : "text/html", retrievedAt: now,
      pdfText: pdf ? readFileSync(resolve(fullSourceDirectory!, item.filename.replace(/\.pdf$/, ".txt")), "utf8") : undefined });
    assert.equal(bytes.byteLength, item.bytes); assert.equal(doc.rawSha256, item.sha256);
    const result = record(doc);
    assert.deepEqual(result.period, item.period, item.filename);
    assert.equal(result.metrics[0].value, item.revenue, item.filename); assert.equal(result.metrics[1].value, item.yoy, item.filename);
    // A formal SEC announcement without the reviewed opening byline explicitly
    // records null; metadata does not fill an unavailable announcement date.
    const expectedAnnouncement = item.announcementDate === undefined
      ? item.source.publishedAt?.value.slice(0, 10) ?? item.source.filingDate : item.announcementDate;
    assert.equal(result.announcementDate, expectedAnnouncement, item.filename);
    const announcement = result.announcementDateEvidence;
    if (expectedAnnouncement === null) assert.equal(announcement, null, item.filename);
    else {
      assert.ok(announcement, item.filename);
      assert.equal(doc.text.slice(announcement.start, announcement.end), announcement.text, item.filename);
    }
    assert.equal(result.completeness, "full"); assert.ok(result.metrics.every(metric => metric.sourceEvidenceKind === "raw_document"));
  }
});
