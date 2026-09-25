import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Firestore } from "firebase-admin/firestore";
import { cnMapCompanies } from "../../src/lib/knowledge-graph/cn-companies";
import { combineGraphs, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { attachCnMarketCaps } from "../../src/lib/knowledge-graph/cn-market-caps";
import { marketCapDescription, marketCapScale } from "../../src/lib/knowledge-graph/market-cap";
import { calculateCnMarketCap, classifyAnnouncement, combineShareCount, parseCninfoAnnouncements, parseCninfoDividends, parseCninfoListing,
  parseCninfoStructure, parseSseShareStructure, parseSzseAShareList, pendingActions, resolveDistributions, selectFx, shareRefreshDue,
  sourceFailed, type CnActionCheck, type CnListing, type CnShareCount, type CninfoStructure } from "../../src/lib/fundamentals/cn-market-cap";
import { publicCnMarketCap } from "../../src/lib/fundamentals/cn-service";
import { cnRunFailed, refreshCnFundamentals } from "../../src/lib/fundamentals/cn-refresh";
import { CnSourceError, createCnRequester, createCnSources, type CnSources } from "../../src/lib/fundamentals/cn-sources";
import { createMaintenanceLog } from "../../src/lib/maintenance-log";

// Payloads below are trimmed copies of live responses captured on 2026-09-24.
const cninfo = (records: Record<string, unknown>[]) => ({ code: 200, data: { resultMsg: "success", records } });
const smicStructure = cninfo([
  { VARYDATE: "2026-09-10", F002V: "增发新股上市,股权激励,期权行权", F021N: 801508.2512, F022N: 200059.3909, F023N: null, F024N: 601448.8603, F028N: 54718.2073, F003N: 856226.4585 },
  { VARYDATE: "2026-09-09", F002V: "增发新股上市,股权激励,期权行权", F021N: 801405.1152, F022N: 199956.2549, F023N: null, F024N: 601448.8603, F028N: 54718.2073, F003N: 856123.3225 },
]);
const zteStructure = cninfo([{ VARYDATE: "2026-07-20", F002V: "其他", F021N: 478312.3766, F022N: 402762.1232, F023N: null, F024N: 75550.2534, F028N: 41.1121, F003N: 478353.4887 }]);
const jcetStructure = cninfo([{ VARYDATE: "2026-06-30", F002V: "定期报告", F021N: 178941.4570, F022N: 178941.4570, F023N: null, F024N: null, F028N: null, F003N: 178941.4570 }]);
const sse = (row: Record<string, string>) => ({ result: [{ TOTAL_DOMESTIC_VOL: "254777.60", A_LIMIT_VOL: "54718.21", TRADE_DATE: "20260924", B_VOL: "0.00", SPECIAL_VOL: "-", TOTAL_UNLIMIT_VOL: "200059.39", A_UNLIMIT_VOL: "200059.39", CDR_VOL: "0.00", ...row }] });
const overview = (code: string, h: string | null) => ({ code: 200, data: { records: [{ basicInformation: [{ ASECCODE: code, BSECCODE: null, HSECCODE: h }] }] } });
const TODAY = "2026-09-25";
const NOW = new Date("2026-09-25T13:30:00Z"); // 21:30 in Shanghai
const url = "https://www.cninfo.com.cn/data20/stockholderCapital/getStockStructure?scode=688981";

function structureOf(payload: unknown): CninfoStructure {
  const parsed = parseCninfoStructure(payload, url, TODAY);
  assert.ok(!sourceFailed(parsed), JSON.stringify(parsed));
  return parsed;
}
const listing = (h: string | null): CnListing => ({ hCode: h, bCode: null, checkedAt: NOW.toISOString(), sourceUrl: "https://www.cninfo.com.cn/data20/companyOverview/getCompanyIntroduction?scode=688981", sourceType: "cninfo_company_overview" });
function smicCount(overrides: Partial<CnShareCount> = {}): CnShareCount {
  const exchange = parseSseShareStructure(sse({}), "https://query.sse.com.cn/commonQuery.do?companyCode=688981");
  assert.ok(!sourceFailed(exchange));
  const count = combineShareCount({ structure: structureOf(smicStructure), listing: listing("00981"), exchange, exchangeStatus: "matched", fetchedAt: NOW.toISOString(), today: TODAY });
  assert.ok(!sourceFailed(count), JSON.stringify(count));
  return { ...count, ...overrides };
}
const check = (events: CnActionCheck["events"] = [], checkedAt = NOW.toISOString()): CnActionCheck => ({ checkedAt, from: "2026-08-11", sourceUrl: "https://www.cninfo.com.cn/", sourceType: "cninfo_announcements", events });
const price = (close = 100, tradingDate = "2026-09-25", ticker = "XSHG:688981") => ({ ticker, market: "CN_A", tradingDate, close });
const fx = { rate: 7.1, date: "2026-09-24", source: "eod_prices/FX_USD_CNY_2026-09-24" };

test("company picker selects Shanghai/Shenzhen A-share companies from the rendered graph only", () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../data/ai-supply-chain/${name}`, import.meta.url), "utf8"));
  const graph = combineGraphs([read("ai-us.json"), read("ai-cn-a.json")] as (KnowledgeGraph & { id: string; language: string })[]);
  const ids = cnMapCompanies(graph);
  assert.equal(ids.length, 62);
  assert.ok(ids.includes("XSHG:688981") && ids.includes("XSHE:000063"));
  assert.deepEqual(cnMapCompanies({ nodes: [
    { id: "XSHE:300308", kind: "COMPANY", order: 0 }, { id: "XSHE:300308", kind: "COMPANY", order: 1 }, { id: "XSHG:688041", kind: "COMPANY", order: 2 },
    { id: "US:NVDA", kind: "COMPANY", order: 3 }, { id: "XSHG:900901", kind: "COMPANY", order: 4 }, { id: "XBSE:830799", kind: "COMPANY", order: 5 },
    { id: "ORG:OPENAI", kind: "COMPANY", order: 6 }, { id: "XSHG:688981", kind: "STAGE", order: 7 },
  ] }), ["XSHE:300308", "XSHG:688041"]);
});

test("share structures parse exactly, including H shares, and malformed payloads fail closed", () => {
  const smic = structureOf(smicStructure);
  assert.deepEqual({ total: smic.totalShares, a: smic.aShares, tradable: smic.aTradableShares, h: smic.hShares, date: smic.date },
    { total: 8_562_264_585, a: 2_547_775_982, tradable: 2_000_593_909, h: 6_014_488_603, date: "2026-09-10" });
  const zte = structureOf(zteStructure);
  assert.equal(zte.totalShares, 4_783_534_887); assert.equal(zte.hShares, 755_502_534); assert.equal(zte.aShares, 4_028_032_353);
  assert.equal(structureOf(jcetStructure).hShares, 0);
  // Classes must reconcile to the total; future records and bad shapes are rejected.
  assert.deepEqual(parseCninfoStructure(cninfo([{ ...smicStructure.data.records[0], F003N: 900000 }]), url, TODAY), { reason: "inconsistent_share_structure" });
  assert.deepEqual(parseCninfoStructure(cninfo([{ ...smicStructure.data.records[0], VARYDATE: "2026-10-01" }]), url, TODAY), { reason: "missing_share_structure" });
  assert.deepEqual(parseCninfoStructure({ code: 200, data: { resultMsg: "fail" } }, url, TODAY), { reason: "unrecognized_source_format" });
  assert.deepEqual(parseCninfoStructure(cninfo([{ ...smicStructure.data.records[0], F003N: "n/a" }]), url, TODAY), { reason: "unrecognized_source_format" });

  const exchange = parseSseShareStructure(sse({}), "https://query.sse.com.cn/");
  assert.ok(!sourceFailed(exchange));
  assert.equal(exchange.domesticShares, 2_547_776_000); assert.equal(exchange.date, "2026-09-24");
  assert.deepEqual(parseSseShareStructure({ result: [sse({}).result[0], sse({}).result[0]] }, ""), { reason: "ambiguous_share_structure" });
  assert.deepEqual(parseSseShareStructure(sse({ CDR_VOL: "10.00" }), ""), { reason: "cdr_share_structure_unsupported" });
  assert.deepEqual(parseSseShareStructure(sse({ A_LIMIT_VOL: "1.00" }), ""), { reason: "inconsistent_share_structure" });

  const szse = parseSzseAShareList([{ metadata: { cols: { agdm: "A股代码", agzgb: "A股总股本", agltgb: "A股流通股本" } },
    data: [{ agdm: "000063", agzgb: "4,028,032,353", agltgb: "4,027,621,232" }] }], "000063", "https://www.szse.cn/", TODAY);
  assert.ok(!sourceFailed(szse)); assert.equal(szse.domesticShares, 4_028_032_353);
  assert.deepEqual(parseSzseAShareList([{ data: [] }], "000063", "", TODAY), { reason: "missing_share_structure" });

  const parsedListing = parseCninfoListing(overview("688981", "00981"), "688981", "u", NOW.toISOString());
  assert.ok(!sourceFailed(parsedListing)); assert.equal(parsedListing.hCode, "00981");
  assert.deepEqual(parseCninfoListing(overview("600000", null), "688981", "u", ""), { reason: "listing_identity_unavailable" });
});

test("A+H companies use A-share close × all issued shares and require the H-share count", () => {
  const count = smicCount();
  assert.equal(count.totalShares, 8_562_264_585);
  assert.equal(count.aShares + count.hShares!, count.totalShares);
  assert.equal(count.exchangeCheck.status, "matched");
  const cap = calculateCnMarketCap({ id: "XSHG:688981", count, check: check(), price: price(100), latestSession: "2026-09-25", fx, now: NOW });
  assert.equal(cap.status, "estimated"); assert.equal(cap.method, "a_close_x_total_shares");
  assert.equal(cap.value, 100 * 8_562_264_585);
  // An issuer with an H listing but no H-share record never falls back to A shares only.
  const structure = structureOf(jcetStructure);
  assert.deepEqual(combineShareCount({ structure, listing: listing("00981"), exchange: null, exchangeStatus: "unreachable", fetchedAt: "", today: TODAY }), { reason: "h_share_count_unavailable" });
  assert.deepEqual(combineShareCount({ structure, listing: null, exchange: null, exchangeStatus: "unreachable", fetchedAt: "", today: TODAY }), { reason: "listing_identity_unavailable" });
  // A newer dated exchange count supersedes the lagging domestic component.
  const exchange = parseSseShareStructure(sse({ TOTAL_DOMESTIC_VOL: "254800.00", A_UNLIMIT_VOL: "200081.79" }), "");
  assert.ok(!sourceFailed(exchange));
  const updated = combineShareCount({ structure: structureOf(smicStructure), listing: listing("00981"), exchange, exchangeStatus: "matched", fetchedAt: "", today: TODAY });
  assert.ok(!sourceFailed(updated));
  assert.equal(updated.totalShares,2_548_000_000+6_014_488_603);
  assert.equal(updated.secondarySource?.hShares,6_014_488_603);
  for (const invalid of [{...exchange,date:"2026-09-10"},{...exchange,date:"2026-09-26"},{...exchange,sourceType:"szse_a_share_list"}]) {
    assert.deepEqual(combineShareCount({structure:structureOf(smicStructure),listing:listing("00981"),exchange:invalid,exchangeStatus:"matched",fetchedAt:"",today:TODAY}),{reason:"exchange_share_count_mismatch"});
  }
  assert.equal(calculateCnMarketCap({id:"XSHG:688981",count:updated,check:check(),price:price(100,"2026-09-23"),latestSession:TODAY,fx,now:NOW}).reason,"share_count_newer_than_price");
});

test("share-change announcements are classified; cash-only dividends are resolved away", () => {
  const repurchase={date:"2026-09-21",settleBy:"2026-09-26",kind:"buyback_cancellation" as const,title:"关于股份回购实施结果暨股份变动的公告",url:"https://static.cninfo.com.cn/finalpage/2026-09-21/1225575075.PDF"};
  const basis={date:"2026-09-08",asOf:"2026-09-25"};
  assert.equal(pendingActions(basis,check([repurchase]),TODAY).length,0);
  const prefixed=parseCninfoAnnouncements({announcements:[{secCode:"301308",announcementTitle:"<em>江波龙</em>：关于股份回购实施结果暨股份变动的公告",announcementTime:Date.parse("2026-09-21T00:00:00Z"),adjunctUrl:"finalpage/2026-09-21/1225575075.PDF"}]},"301308");
  assert.ok(!sourceFailed(prefixed));
  assert.equal(pendingActions(basis,check(prefixed),TODAY).length,0);
  assert.equal(pendingActions(basis,check([{...repurchase,url:"https://example.com/different-cancellation.pdf"}]),TODAY).length,1);
  assert.equal(pendingActions(basis,check([{...repurchase,title:"回购注销部分限制性股票减少注册资本通知债权人的公告"}]),TODAY).length,0);
  assert.equal(classifyAnnouncement("关于股份回购实施结果暨股份变动的公告")?.kind, "buyback_cancellation");
  assert.equal(classifyAnnouncement("<em>中芯国际</em>发行股份购买资产暨关联交易实施情况暨新增股份上市公告书")?.kind, "placement");
  assert.equal(classifyAnnouncement("2026年半年度权益分派实施公告")?.kind, "distribution");
  assert.equal(classifyAnnouncement("2025年年度权益分派及资本公积金转增股本实施公告")?.kind, "bonus_or_conversion");
  assert.equal(classifyAnnouncement("关于限制性股票激励计划归属结果暨股份上市的公告")?.kind, "share_change");
  assert.equal(classifyAnnouncement("关于回购股份方案的公告"), null);
  assert.equal(classifyAnnouncement("关于回购注销部分限制性股票减少注册资本通知债权人的公告"),null);
  assert.equal(classifyAnnouncement("关于回购注销完成暨通知债权人的公告")?.kind,"buyback_cancellation");
  assert.equal(classifyAnnouncement("2026年半年度报告"), null);
  const events = parseCninfoAnnouncements({ announcements: [
    { secCode: "600584", announcementTitle: "<em>江苏长电科技股份有限公司</em>2026年半年度权益分派实施公告", announcementTime: Date.parse("2026-09-17T16:00:00Z"), adjunctUrl: "finalpage/2026-09-18/1225570357.PDF" },
    { secCode: "600584", announcementTitle: "2026年半年度报告", announcementTime: Date.parse("2026-08-20T16:00:00Z") },
    { secCode: "999999", announcementTitle: "关于股份回购实施结果暨股份变动的公告", announcementTime: Date.parse("2026-09-10T16:00:00Z") },
  ] }, "600584");
  assert.ok(!sourceFailed(events));
  assert.deepEqual(events.map(e => [e.date, e.kind, e.url]), [["2026-09-18", "distribution", "https://static.cninfo.com.cn/finalpage/2026-09-18/1225570357.PDF"]]);
  const dividends = parseCninfoDividends(cninfo([{ F001V: "2026半年报", F007V: "10派0.5元(含税)", F018D: "2026-09-23", F020D: "2026-09-24" },
    { F001V: "2025年报", F007V: "10转增4.9股派3.5元(含税)", F018D: "2026-05-28", F020D: "2026-05-29" }]));
  assert.ok(!sourceFailed(dividends));
  assert.deepEqual(resolveDistributions(events, dividends), []);
  const bonus = resolveDistributions([{ ...events[0], date: "2026-05-22", settleBy: "2026-06-06" }], dividends);
  assert.deepEqual(bonus.map(e => [e.kind, e.effectiveDate, e.settleBy]), [["bonus_or_conversion", "2026-05-29", "2026-06-03"]]);
  // No matching dividend record: stay conservative.
  assert.equal(resolveDistributions(events, []).length, 1);
});

test("corporate actions after the stored count block valuation until the count reflects them", () => {
  const base = smicCount({ date: "2026-09-10", asOf: "2026-09-19" });
  const placement = { date: "2026-09-20", settleBy: "2026-09-25", kind: "placement" as const, title: "新增股份上市公告书", url: "" };
  const input = { id: "XSHG:688981", check: check([placement]), price: price(), latestSession: "2026-09-25", fx, now: NOW };
  assert.equal(calculateCnMarketCap({ ...input, count: base }).reason, "corporate_action_after_share_count");
  assert.equal(shareRefreshDue(base, check([placement]), TODAY), "corporate_action");
  // Re-verified after the settlement window: the event is reflected.
  assert.equal(calculateCnMarketCap({ ...input, count: { ...base, asOf: "2026-09-25" } }).status, "estimated");
  // A bonus issue settles when the structure took effect on/after the ex-date...
  const bonus = { ...placement, kind: "bonus_or_conversion" as const, effectiveDate: "2026-09-22", settleBy: "2026-09-27" };
  assert.equal(calculateCnMarketCap({ ...input, check: check([bonus]), count: { ...base, date: "2026-09-22", asOf: TODAY } }).status, "estimated");
  // ...and an ex-date after the price date does not affect that price.
  const future = { ...bonus, effectiveDate: "2026-09-29", settleBy: "2026-10-04" };
  assert.equal(pendingActions(base, check([future]), "2026-09-25").length, 0);
  assert.equal(calculateCnMarketCap({ ...input, check: check([future]), count: base }).status, "estimated");
  // Without a recent announcement check the guard cannot be evaluated.
  assert.equal(calculateCnMarketCap({ ...input, check: null, count: base }).reason, "corporate_action_check_unavailable");
  assert.equal(calculateCnMarketCap({ ...input, check: check([], "2026-09-20T00:00:00Z"), count: base }).reason, "corporate_action_check_unavailable");
});

test("staleness guards: 7-day refresh, 180-day limit, and no share count dated after the price", () => {
  const count = smicCount();
  assert.equal(shareRefreshDue(null, null, TODAY), "missing");
  assert.equal(shareRefreshDue(count, check(), TODAY), null);
  assert.equal(shareRefreshDue({ ...count, asOf: "2026-09-18" }, check(), TODAY), "stale");
  const input = { id: "XSHG:688981", check: check(), latestSession: "2026-09-25", fx, now: NOW };
  assert.equal(calculateCnMarketCap({ ...input, count: { ...count, asOf: "2026-03-01" }, price: price() }).reason, "stale_share_count");
  assert.equal(calculateCnMarketCap({ ...input, count: { ...count, date: "2026-09-25" }, price: price(100, "2026-09-24") }).reason, "share_count_newer_than_price");
  for (const bad of [undefined, price(100, "2026-09-25", "XSHG:600584"), { ...price(), market: "US" }, price(0), price(NaN), price(100, "2026-09-30")]) {
    assert.equal(calculateCnMarketCap({ ...input, count, price: bad }).reason, "missing_or_invalid_cached_price");
  }
  assert.equal(calculateCnMarketCap({ ...input, count: null, price: price() }).reason, "shares_not_yet_refreshed");
  assert.equal(calculateCnMarketCap({ ...input, count, countReason: "h_share_count_unavailable", price: price() }).reason, "h_share_count_unavailable");
});

test("CNY values convert to USD at that date's USD/CNY rate, recording the rate date", () => {
  const rates = [{ date: "2026-09-24", close: 7.1 }, { date: "2026-09-22", close: 7.2 }, { date: "2026-09-26", close: 7.0 }, { date: "2026-09-10", close: 7.3 }];
  assert.deepEqual(selectFx(rates, "2026-09-25"), { rate: 7.1, date: "2026-09-24", source: "eodhd-eod" });
  assert.equal(selectFx([{ date: "2026-09-10", close: 7.3 }], "2026-09-25"), null);
  assert.equal(selectFx([{ date: "2026-09-24", close: 0 }], "2026-09-25"), null);
  const count = smicCount();
  const cap = calculateCnMarketCap({ id: "XSHG:688981", count, check: check(), price: price(71), latestSession: "2026-09-25", fx, now: NOW });
  assert.equal(cap.currency, "CNY");
  assert.deepEqual(cap.usd, { value: 71 * count.totalShares / 7.1, rate: 7.1, rateDate: "2026-09-24", source: fx.source });
  const noFx = calculateCnMarketCap({ id: "XSHG:688981", count, check: check(), price: price(71), latestSession: "2026-09-25", fx: null, now: NOW });
  assert.equal(noFx.status, "estimated"); assert.equal(noFx.usd, null); assert.equal(noFx.usdReason, "missing_fx_rate");
});

test("suspended stocks use their last close, labelled with its own date", () => {
  const count = smicCount({ date: "2026-06-30" });
  const cap = calculateCnMarketCap({ id: "XSHG:688981", count, check: check(), price: price(80, "2026-09-01"), latestSession: "2026-09-25", fx, now: NOW });
  assert.equal(cap.status, "estimated"); assert.equal(cap.lastClose, true); assert.equal(cap.priceDate, "2026-09-01");
  assert.equal(cap.value, 80 * count.totalShares);
  const view = publicCnMarketCap(cap);
  assert.equal(view?.lastClose, true); assert.equal(view?.shares?.h, 6_014_488_603);
  assert.equal(publicCnMarketCap({ ...cap, currency: "USD" }), null);
  assert.equal(publicCnMarketCap({ ...cap, shares: { ...cap.shares, sourceUrl: "javascript:alert(1)" } })?.status, "unavailable");
});

function memoryDb(docs: Record<string, Record<string, unknown>>, prices: Record<string, unknown>[] = [], fxDocs: Record<string, Record<string, unknown>> = {}) {
  const writes: [string, Record<string, unknown>][] = [];
  const ref = (collection: string, id: string) => ({ id, path: `${collection}/${id}`,
    get: async () => ({ id, exists: Boolean(docs[id]), data: () => docs[id], get: (key: string) => docs[id]?.[key] }),
    set: async (value: Record<string, unknown>) => { writes.push([id, value]); docs[id] = { ...docs[id], ...value }; } });
  const db = {
    collection: (name: string) => name === "tickers"
      ? { where: () => ({ select: () => ({ get: async () => ({ docs: prices.map(p => ({ data: () => ({ latestEodPrice: p }) })) }) }) }) }
      : { doc: (id: string) => name === "eod_prices" ? { id, get: async () => ({ id, data: () => fxDocs[id] }) } : ref(name, id) },
    getAll: async (...refs: { id: string; get: () => Promise<unknown> }[]) => Promise.all(refs.map(r => r.get())),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      get: (r: { get: () => Promise<unknown> }) => r.get(),
      set: (r: { id: string }, value: Record<string, unknown>) => { writes.push([r.id, value]); docs[r.id] = { ...docs[r.id], ...value }; },
    }),
  } as unknown as Firestore;
  return { db, writes };
}
function fakeSources(overrides: Partial<CnSources> = {}): CnSources {
  return {
    structure: async () => structureOf(smicStructure),
    listing: async () => listing("00981"),
    exchange: async () => { const e = parseSseShareStructure(sse({}), "https://query.sse.com.cn/"); assert.ok(!sourceFailed(e)); return e; },
    orgId: async () => "gshk0000981",
    actions: async () => check(),
    ...overrides,
  };
}
const fxDoc = { "FX_USD_CNY_2026-09-24": { market: "FX", ticker: "USD_CNY", tradingDate: "2026-09-24", close: 7.1 } };

test("job refreshes counts, writes CNY and USD market caps, and dry runs print without writing", async (t) => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {}); t.mock.method(console, "warn", () => {});
  const log = createMaintenanceLog("test");
  const dry = memoryDb({}, [price(50)], fxDoc);
  const lines: string[] = [];
  const dryResult = await refreshCnFundamentals({ db: dry.db, log, sources: fakeSources(), companies: ["XSHG:688981"], deadline: Date.now() + 600_000, dryRun: true, now: () => NOW, print: line => lines.push(line) });
  assert.equal(dry.writes.length, 0);
  assert.equal(dryResult.marketCaps.estimated, 1);
  const printed = JSON.parse(lines[0]);
  assert.equal(printed.shares.total, 8_562_264_585); assert.equal(printed.shares.h, 6_014_488_603);
  assert.equal(printed.price.close, 50); assert.equal(printed.fx.usdCny, 7.1); assert.equal(printed.fx.date, "2026-09-24");
  assert.equal(printed.marketCapCny, 50 * 8_562_264_585); assert.equal(printed.marketCapUsd, 50 * 8_562_264_585 / 7.1);

  const real = memoryDb({}, [price(50)], fxDoc);
  const result = await refreshCnFundamentals({ db: real.db, log, sources: fakeSources(), companies: ["XSHG:688981"], deadline: Date.now() + 600_000, now: () => NOW });
  assert.equal(result.shares.refreshed, 1); assert.equal(result.actions.checked, 1);
  const stored = (await real.db.collection("company_fundamentals").doc("XSHG:688981").get()).data() as Record<string, { value?: number; usd?: { value: number } }>;
  assert.equal(stored.marketCap.value, 50 * 8_562_264_585);
  assert.equal(stored.marketCap.usd?.value, 50 * 8_562_264_585 / 7.1);
  assert.ok(real.writes.every(([id]) => id === "XSHG:688981"), "only the A-share document is written");
  assert.ok(real.writes.every(([, value]) => !("pending" in value) && !("value" in value) && !("version" in value)), "never touches SEC queue fields");
});

test("job keeps old data on provider failure, applies cooldowns, and honours per-company leases", async (t) => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {}); t.mock.method(console, "warn", () => {});
  const log = createMaintenanceLog("test");
  const previous = smicCount({ asOf: "2026-09-10" });
  const { db } = memoryDb({ "XSHG:688981": { cnShares: previous, cnActions: check(), cnOrgId: "gshk0000981" } }, [price(50)], fxDoc);
  let structureCalls = 0;
  const blocked = fakeSources({ structure: async () => { structureCalls++; throw new CnSourceError("www.cninfo.com.cn request failed (429)", 429, "www.cninfo.com.cn"); } });
  const result = await refreshCnFundamentals({ db, log, sources: blocked, companies: ["XSHG:688981"], deadline: Date.now() + 600_000, now: () => NOW });
  assert.equal(result.shares.failed, 1);
  const stored = (await db.collection("company_fundamentals").doc("XSHG:688981").get()).data() as Record<string, Record<string, unknown>>;
  assert.deepEqual(stored.cnShares, previous);
  assert.equal(stored.cnShareStatus.outcome, "retry");
  assert.ok(Number(stored.cnShareStatus.retryAfter) > NOW.getTime());
  assert.ok(Number(((await db.collection("company_fundamentals").doc("_cn_worker").get()).data() as { providerRetryAfter: Record<string, number> }).providerRetryAfter.www_cninfo_com_cn) > NOW.getTime());
  // The previous count still values the company; the next run respects the cooldown.
  assert.equal((stored.marketCap as { status: string }).status, "estimated");
  await refreshCnFundamentals({ db, log, sources: blocked, companies: ["XSHG:688981"], deadline: Date.now() + 600_000, now: () => NOW });
  assert.equal(structureCalls, 1);

  const leased = memoryDb({ "XSHG:688981": { cnLeaseUntil: NOW.getTime() + 60_000, cnLeaseOwner: "other-run" } }, [], fxDoc);
  let calls = 0;
  const skip = await refreshCnFundamentals({ db: leased.db, log, sources: fakeSources({ actions: async () => { calls++; return check(); } }), companies: ["XSHG:688981"], deadline: Date.now() + 600_000, now: () => NOW });
  assert.equal(calls, 0); assert.equal(skip.shares.skipped, 1);
});

test("graph loader attaches A-share caps in USD for sizing, with the CNY value and rate date", async () => {
  const count = smicCount();
  const cap = calculateCnMarketCap({ id: "XSHG:688981", count, check: check(), price: price(100), latestSession: "2026-09-25", fx, now: NOW });
  const docs: Record<string, unknown> = { "XSHG:688981": { marketCap: cap }, "XSHE:000063": { marketCap: { ...cap, usd: null } }, "XSHE:300308": { marketCap: { ...cap, status: "unavailable" } } };
  const requested: string[] = [];
  const db = { collection: () => ({ doc: (id: string) => ({ id }) }),
    getAll: async (...args: unknown[]) => (args.filter(a => typeof (a as { id?: unknown }).id === "string") as { id: string }[]).map(r => { requested.push(r.id); return { data: () => docs[r.id] }; }) } as unknown as Firestore;
  const graph: Pick<KnowledgeGraph, "nodes"> = { nodes: [{ id: "XSHG:688981", kind: "COMPANY", order: 0 }, { id: "XSHE:000063", kind: "COMPANY", order: 1 },
    { id: "XSHE:300308", kind: "COMPANY", order: 2 }, { id: "US:NVDA", kind: "COMPANY", order: 3 }] };
  await attachCnMarketCaps(db, graph);
  assert.deepEqual(requested, ["XSHG:688981", "XSHE:000063", "XSHE:300308"]);
  const smic = graph.nodes[0].marketCap!;
  assert.deepEqual(smic, { value: cap.usd!.value, currency: "USD", priceDate: "2026-09-25", local: { value: cap.value!, currency: "CNY", rateDate: "2026-09-24" } });
  assert.ok(marketCapScale(smic) > 1);
  assert.equal(graph.nodes[1].marketCap, undefined);
  assert.equal(graph.nodes[2].marketCap, undefined);
  assert.match(marketCapDescription(smic, "en"), /¥856\.23B CNY \(≈ \$120\.6B USD\) · As of 2026-09-25/);
  assert.match(marketCapDescription(smic, "zh-CN"), /估算市值: ¥8,562\.26亿 CNY/);
});

test("a run that reaches its deadline still recalculates stored valuations and reports incomplete sources", async (t) => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "warn", () => {});
  const { db } = memoryDb({ "XSHG:688981": { cnShares: smicCount(), cnActions: check() } }, [price(50)], fxDoc);
  let calls = 0;
  const result = await refreshCnFundamentals({ db, log: createMaintenanceLog("test"), sources: fakeSources({ actions: async () => { calls++; return check(); } }),
    companies: ["XSHG:688981"], deadline: Date.now(), now: () => NOW });
  assert.equal(calls, 0); assert.equal(result.sourcesIncomplete, true);
  assert.equal(result.marketCaps.estimated, 1);
});

// cninfo answering HTTP 200 with an error body or a changed schema is a source
// failure: previously published counts and valuations must stay untouched.
async function runAgainstCninfo(structureBody: unknown, companies: string[]) {
  const published = calculateCnMarketCap({ id: "XSHG:688981", count: smicCount({ asOf: "2026-09-10" }), check: check(), price: price(40, "2026-09-10"), latestSession: "2026-09-10", fx, now: new Date("2026-09-10T13:30:00Z") });
  assert.equal(published.status, "estimated");
  const docs: Record<string, Record<string, unknown>> = {};
  for (const id of companies) docs[id] = { cnShares: smicCount({ asOf: "2026-09-10" }), cnActions: check(), cnOrgId: "org", marketCap: { ...published } };
  const before = structuredClone(docs);
  const { db } = memoryDb(docs, companies.map(id => price(50, "2026-09-25", id)), fxDoc);
  const fetcher = (async (input: string | URL) => {
    const url = String(input);
    const body = url.includes("getStockStructure") ? structureBody : url.includes("hisAnnouncement") ? { announcements: null, hasMore: false } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const sources = createCnSources(createCnRequester({ spacingMs: 0, fetcher }));
  const result = await refreshCnFundamentals({ db, log: createMaintenanceLog("test"), sources, companies, deadline: Date.now() + 600_000, now: () => NOW });
  return { result, docs, before };
}
for (const [label, body] of [
  ["a 200 error payload", { code: 200, data: { resultMsg: "fail", resultCode: "500", records: null }, msg: "系统繁忙" }],
  ["a changed schema", cninfo([{ CHANGE_DATE: "2026-09-10", TOTAL_SHARES: 856226.4585, A_SHARES: 254777.5982, H_SHARES: 601448.8603 }])],
] as const) {
  test(`cninfo ${label} is a retryable failure that keeps the published valuation and fails the run`, async (t) => {
    t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {}); t.mock.method(console, "warn", () => {});
    const companies = ["XSHG:688981", "XSHG:688347", "XSHE:000063"];
    const { result, docs, before } = await runAgainstCninfo(body, companies);
    assert.equal(result.shares.failed, 3); assert.equal(result.shares.unavailable, 0);
    assert.equal(result.marketCaps.kept, 3); assert.equal(result.marketCaps.processed, 0);
    for (const id of companies) {
      assert.deepEqual(docs[id].marketCap, before[id].marketCap, `${id} keeps its published market cap`);
      assert.deepEqual(docs[id].cnShares, before[id].cnShares, `${id} keeps its share count`);
      const status = docs[id].cnShareStatus as { outcome: string; reason: string | null; retryAfter: number; lastError: { code: string } };
      assert.equal(status.outcome, "retry"); assert.equal(status.reason, null);
      assert.equal(status.lastError.code, "unrecognized_source_format");
      assert.ok(status.retryAfter > NOW.getTime());
    }
    assert.equal(cnRunFailed(result), true);
  });
}

test("a single transient failure is tolerated but still keeps the published valuation", async (t) => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {}); t.mock.method(console, "warn", () => {});
  const { result, docs, before } = await runAgainstCninfo({ code: 200, data: { resultMsg: "fail" } }, ["XSHG:688981"]);
  assert.equal(result.shares.failed, 1);
  assert.deepEqual(docs["XSHG:688981"].marketCap, before["XSHG:688981"].marketCap);
  assert.equal(cnRunFailed(result), false);
  assert.equal(cnRunFailed({ ...result, marketCaps: { ...result.marketCaps, failed: 1 } }), true);
  assert.equal(cnRunFailed({ ...result, sourcesIncomplete: true }), true);
});

test("validated outcomes (an H listing without an H-share count) stay unavailable and do not fail the run", async (t) => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {}); t.mock.method(console, "warn", () => {});
  const { db } = memoryDb({ "XSHG:600584": { cnShares: smicCount({ asOf: "2026-09-10" }), cnActions: check() } }, [price(50, "2026-09-25", "XSHG:600584")], fxDoc);
  const sources = fakeSources({ structure: async () => structureOf(jcetStructure), listing: async () => listing("00981"),
    exchange: async () => { const e = parseSseShareStructure(sse({ TOTAL_DOMESTIC_VOL: "178941.46", A_LIMIT_VOL: "0.00", A_UNLIMIT_VOL: "178941.46" }), ""); assert.ok(!sourceFailed(e)); return e; } });
  const result = await refreshCnFundamentals({ db, log: createMaintenanceLog("test"), sources, companies: ["XSHG:600584"], deadline: Date.now() + 600_000, now: () => NOW });
  assert.equal(result.shares.unavailable, 1); assert.equal(result.shares.failed, 0);
  const stored = (await db.collection("company_fundamentals").doc("XSHG:600584").get()).data() as Record<string, { status?: string; reason?: string; outcome?: string }>;
  assert.equal(stored.cnShareStatus.outcome, "unavailable");
  assert.equal(stored.marketCap.status, "unavailable"); assert.equal(stored.marketCap.reason, "h_share_count_unavailable");
  assert.equal(cnRunFailed(result), false);
});
