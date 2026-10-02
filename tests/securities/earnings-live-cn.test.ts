import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CN_EARNINGS_ORGS, CnEarningsSourceError, createCnEarningsRequester, createCnEarningsSources, makeCnEarningsPlan, parseCnEarningsOrg, type CnEarningsBlock } from "../../src/lib/earnings/live-cn";
import { extractEarnings } from "../../src/lib/earnings/extract";
import { sha256, sourceIdentity, type RawEarningsDocument } from "../../src/lib/earnings/model";

const now = "2026-10-02T11:25:00Z";
const root = resolve("tests/fixtures/earnings/cn");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const layouts: { name: string; issuerHeading: string; table: string }[] = json(resolve("tests/fixtures/earnings/live-cn/layouts.json"));
function fixture(name: string) { return json(resolve(root, `${name}.json`)); }
// This is synthetic document scaffolding around explicitly labelled factual
// layout excerpts. Live full-PDF verification is recorded separately in the
// fixture directory; these unit tests do not claim to contain original PDFs.
function document(name = "longsys-q1-2026", transform: (text: string) => string = text => text): RawEarningsDocument {
  const sample = layouts.find(row => row.name === name)!, meta = fixture(name);
  const text = transform(`${sample.issuerHeading}\n${meta.source.title}\n\f${sample.table}\n\f分产品收入\n营业收入 999 999 999%\n`);
  return { source: meta.source, sourceId: sourceIdentity(meta.source), rawSha256: sha256("synthetic layout test"), textSha256: sha256(text), text,
    mediaType: "application/pdf", textMethod: "pdftotext-layout", completeness: "full", retrievedAt: now };
}
function extract(doc: RawEarningsDocument) {
  const plan = makeCnEarningsPlan(doc);
  assert.ok(plan, "reviewed layout should resolve");
  const result = extractEarnings(doc, plan, now);
  assert.equal(result.status, "extracted", JSON.stringify(result));
  if (result.status !== "extracted") throw new Error("Extraction failed");
  return result.record;
}
for (const sample of layouts) test(`dynamic CN plan resolves reviewed layout: ${sample.name}`, () => {
  const doc = document(sample.name), expected = fixture(sample.name).expected, record = extract(doc);
  assert.deepEqual(record.period, expected.period);
  assert.equal(record.kind, expected.kind);
  const revenue = record.metrics[0];
  assert.equal(revenue.value, expected.revenue); assert.equal(revenue.scale, expected.scale);
  assert.equal(revenue.currency, "CNY"); assert.equal(revenue.basis, "PRC_GAAP");
  assert.equal(revenue.scope, "consolidated");
  if (record.kind === "forecast") {
    assert.equal(revenue.low, expected.lower); assert.equal(revenue.high, expected.upper);
    assert.equal(record.metrics.length, 1); // No invented YoY from range endpoints.
  } else assert.equal(record.metrics[1].value, expected.yoy);
  if (sample.name.includes("h1")) { assert.equal(record.period.type, "half_year"); assert.equal(record.period.fiscalQuarter, undefined); }
  assert.ok(record.metrics.every(metric => metric.evidence.every(evidence => doc.text.slice(evidence.start, evidence.end) === evidence.text)));
});

test("future report dates, values and native scales come from text, without amounts embedded in plan", () => {
  const original = document("smic-q1-2026");
  const doc = document("smic-q1-2026", text => text.replaceAll("2026", "2027").replaceAll("千元", "万元").replace("17,617,218", "27,617,218").replace(/8\.1\b/, "-18.7"));
  doc.source = { ...doc.source, title: doc.source.title.replace("2026", "2027"), publishedAt: { value: "2027-05-01", precision: "date", timezone: "Asia/Shanghai" } };
  const plan = makeCnEarningsPlan(doc)!;
  assert.equal(plan.period.fiscalYear, 2027); assert.equal(plan.metrics[0].scale, 10_000);
  const record = extract(doc);
  assert.equal(record.metrics[0].value, 276172180000); assert.equal(record.metrics[1].value, -18.7);
  assert.ok(!JSON.stringify(plan).includes("27,617,218")); assert.ok(!JSON.stringify(plan).includes("-18.7"));
  const changedValuesOnly = document("smic-q1-2026", text => text.replace("17,617,218", "42,617,218"));
  assert.deepEqual(makeCnEarningsPlan(changedValuesOnly), makeCnEarningsPlan(original));
});
test("explicit preliminary table stays preliminary", () => {
  const doc = document("longsys-q1-2026", text => text.replaceAll("季度报告", "季度业绩快报").replace("主要会计数据和财务指标", "主要财务数据和指标"));
  doc.source = { ...doc.source, title: doc.source.title.replace("季度报告", "季度业绩快报") };
  const record = extract(doc);
  assert.equal(record.kind, "preliminary"); assert.ok(record.metrics.every(metric => metric.kind === "preliminary"));
});
test("source classification, currency, column order and row shape changes require review", () => {
  const source = document();
  for (const title of ["2026年半年度报告摘要", "2026年第三季度报告", "2026年年度报告", "2026年一季度报告披露的提示性公告", "2026年一季度报告英文版", "2026年一季度业绩预告"]) {
    assert.equal(makeCnEarningsPlan({ ...source, source: { ...source.source, title } }), null, title);
  }
  for (const change of [
    (text: string) => text.replaceAll("2026", "2025"),
    (text: string) => text.replace("上年同期               本报告期比", "上年同期               变动数"),
    (text: string) => text.replace(/本报告期(\s+)上年同期/, "上年同期$1本报告期"),
    (text: string) => text.replace("主要会计数据和财务指标", "母公司主要会计数据和财务指标"),
    (text: string) => text.replace("主要会计数据和财务指标", "主要会计数据和财务指标 单位：万元"),
    (text: string) => text.replace("主要会计数据和财务指标", "主要会计数据和财务指标 币种：美元"),
    (text: string) => text.replace("4,256,456,756.59", "4,256,456,756.59 4,000,000,000.00"),
    (text: string) => text.replace("132.79%", "未披露"),
    (text: string) => text.replace("132.79%", "132.79"),
    (text: string) => text.replace("归属于上市公司股东的净利", "业务分部"),
  ]) assert.equal(makeCnEarningsPlan(document("longsys-q1-2026", change)), null);
  assert.equal(makeCnEarningsPlan(document("cambricon-h1-2026", text => text.replace("1－6月", "1－3月"))), null);
  assert.equal(makeCnEarningsPlan({ ...source, completeness: "excerpt" }), null);
  assert.equal(makeCnEarningsPlan({ ...source, textMethod: "plain" }), null);
  assert.equal(makeCnEarningsPlan({ ...source, textSha256: "mismatch" }), null);
  assert.equal(makeCnEarningsPlan(document("smic-q1-2026", text => text.replace("币种：人民币", "币种：美元"))), null);
});
test("forecast range and currency must be explicit, not inferred from profit rows", () => {
  for (const change of [
    (text: string) => text.replace("营业收入", "其他收入"),
    (text: string) => text.replace("2026 年 6 月 30 日", "2026 年 3 月 31 日"),
    (text: string) => text.replaceAll("人民币万元", "美元万元"),
    (text: string) => text.replace("2,200,000   ～    2,500,000", "2,200,000    2,500,000"),
    (text: string) => text.replace("营业收入", "营业收入 1  ～  2  0\n营业收入"),
  ]) assert.equal(makeCnEarningsPlan(document("longsys-h1-forecast-2026", change)), null);
});

const orgPayload = (companyId = "XSHE:301308") => [{ code: companyId.split(":")[1], category: "A股", orgId: CN_EARNINGS_ORGS[companyId as keyof typeof CN_EARNINGS_ORGS], zwjc: companyId === "XSHG:688981" ? "中芯国际" : "江波龙" }];
const announcement = json(resolve(root, "discovery.json")).rows.find((row: { announcementId: string }) => row.announcementId === "1225214140");
test("issuer lookup checks code, A-share category, verified organisation and issuer name", () => {
  assert.equal(parseCnEarningsOrg("XSHE:301308", orgPayload()), "9900048787");
  for (const payload of [null, [], [orgPayload()[0], orgPayload()[0]], [{ ...orgPayload()[0], orgId: "changed" }], [{ ...orgPayload()[0], category: "港股" }], [{ ...orgPayload()[0], zwjc: "其他公司" }]]) {
    assert.throws(() => parseCnEarningsOrg("XSHE:301308", payload));
  }
  assert.throws(() => parseCnEarningsOrg("US:AMD", orgPayload()));
});
test("bounded discovery uses native POST with verified org ID and completes every page", async () => {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const sources = createCnEarningsSources(async (url, init) => {
    const body = new URLSearchParams(String(init.body)); calls.push({ url, body });
    if (init.operation === "cninfo_earnings_org") return orgPayload();
    return { announcements: body.get("pageNum") === "1" ? [announcement] : [], hasMore: body.get("pageNum") === "1", totalAnnouncement: 1 };
  });
  const result = await sources.discover({ companyId: "XSHE:301308", from: "2026-04-01", to: "2026-10-02", firstSeenAt: now });
  assert.equal(result.complete, true); assert.equal(result.pages, 2); assert.equal(result.sources.length, 1);
  assert.equal(calls[0].body.get("keyWord"), "301308");
  assert.equal(calls[1].body.get("stock"), "301308,9900048787");
  assert.equal(calls[1].body.get("column"), "szse"); assert.equal(calls[1].body.get("pageSize"), "30");
  assert.equal(calls[1].body.get("seDate"), "2026-04-01~2026-10-02");
  assert.equal(result.sources[0].publishedAt?.precision, "date");
});
test("discovery never advances on incomplete, oversized, unstable or repeated pages", async () => {
  for (const makePage of [
    () => ({ announcements: [announcement], hasMore: true, totalAnnouncement: 100 }),
    () => ({ announcements: Array(31).fill(announcement), hasMore: false, totalAnnouncement: 31 }),
    () => ({ announcements: [announcement], hasMore: false, totalAnnouncement: 2 }),
    () => ({ announcements: [], hasMore: true, totalAnnouncement: 2 }),
  ]) {
    const sources = createCnEarningsSources(async (_url, init) => init.operation === "cninfo_earnings_org" ? orgPayload() : makePage());
    await assert.rejects(sources.discover({ companyId: "XSHE:301308", from: "2026-04-01", to: "2026-10-02", firstSeenAt: now, maxPages: 2 }));
  }
  let requested = false;
  const source = createCnEarningsSources(async () => { requested = true; return {}; });
  for (const change of [{ from: "2024-01-01" }, { to: "2026-02-30" }, { maxPages: 21 }, { companyId: "US:AMD" }]) {
    await assert.rejects(source.discover({ companyId: "XSHE:301308", from: "2026-04-01", to: "2026-10-02", firstSeenAt: now, ...change }));
  }
  assert.equal(requested, false);
});

const endpoint = "https://www.cninfo.com.cn/new/information/topSearch/query";
const init = { method: "POST", body: "keyWord=301308&maxNum=10", companyId: "XSHE:301308" as const, operation: "cninfo_earnings_org" as const };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
test("requester enforces durable gate, JSON decoding and safe fetch settings", async () => {
  const order: string[] = [];
  const requester = createCnEarningsRequester({ spacingMs: 0, beforeRequest: async context => { order.push("gate"); assert.equal(context.host, "www.cninfo.com.cn"); }, fetcher: async (url, options) => {
    order.push("fetch"); assert.equal(url, endpoint); assert.equal(options?.redirect, "manual"); assert.equal(options?.credentials, "omit"); assert.equal(options?.method, "POST"); assert.ok(options?.signal); return response(orgPayload());
  } });
  assert.deepEqual(await requester.request(endpoint, init), orgPayload()); assert.deepEqual(order, ["gate", "fetch"]);
  await assert.rejects(requester.request("https://evil.test/query", init), /Unapproved/);
});
test("403/429 stop concurrent and subsequent requests and persist Retry-After once", async () => {
  for (const status of [403, 429]) {
    let calls = 0; const cooldowns: CnEarningsBlock[] = [];
    const requester = createCnEarningsRequester({ spacingMs: 0, onBlocked: async block => { cooldowns.push(block); }, fetcher: async () => { calls++; return new Response("blocked", { status, headers: { "retry-after": "3600" } }); } });
    const results = await Promise.allSettled([requester.request(endpoint, init), requester.request(endpoint, init)]);
    assert.ok(results.every(result => result.status === "rejected")); assert.equal(calls, 1);
    assert.deepEqual(cooldowns, [{ host: "www.cninfo.com.cn", code: status, retryAfter: "3600" }]);
    await assert.rejects(requester.request(endpoint, init), error => error instanceof CnEarningsSourceError && error.code === "HOST_SKIPPED");
  }
});
test("requester rejects oversized headers, unbounded streams, HTML and malformed JSON", async () => {
  for (const result of [
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "999" } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' {"large":"too much data"}')); controller.close(); } }), { headers: { "content-type": "application/json" } }),
    new Response("access denied", { headers: { "content-type": "text/html" } }),
    new Response("{", { headers: { "content-type": "application/json" } }),
  ]) {
    const requester = createCnEarningsRequester({ spacingMs: 0, maxBytes: 10, fetcher: async () => result });
    await assert.rejects(requester.request(endpoint, init));
  }
});
test("redirects cannot escape approved HTTPS endpoints or change POST semantics", async () => {
  for (const [status, location] of [[307, "https://evil.test/query"], [307, "http://www.cninfo.com.cn/new/information/topSearch/query"], [302, endpoint], [308, "https://user:pass@www.cninfo.com.cn/new/information/topSearch/query"]] as const) {
    let calls = 0;
    const requester = createCnEarningsRequester({ spacingMs: 0, fetcher: async () => { calls++; return new Response(null, { status, headers: { location } }); } });
    await assert.rejects(requester.request(endpoint, init), /redirect/); assert.equal(calls, 1);
  }
  let calls = 0, gates = 0;
  const requester = createCnEarningsRequester({ spacingMs: 0, beforeRequest: async () => { gates++; }, fetcher: async () => ++calls === 1 ? new Response(null, { status: 307, headers: { location: endpoint } }) : response([]) });
  assert.deepEqual(await requester.request(endpoint, init), []); assert.equal(gates, 2);
  const looping = createCnEarningsRequester({ spacingMs: 0, fetcher: async () => new Response(null, { status: 307, headers: { location: endpoint } }) });
  await assert.rejects(looping.request(endpoint, init), /redirect/);
});
test("network failures and timeout aborts stop the host for this run", async () => {
  for (const error of [new TypeError("network failed"), new DOMException("aborted", "TimeoutError")]) {
    const requester = createCnEarningsRequester({ spacingMs: 0, fetcher: async () => { throw error; } });
    await assert.rejects(requester.request(endpoint, init));
    await assert.rejects(requester.request(endpoint, init), /blocked/);
    assert.ok(requester.blockedHosts()["www.cninfo.com.cn"]);
  }
});
