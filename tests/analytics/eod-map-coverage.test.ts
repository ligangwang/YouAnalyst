import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadEodPriceUniverse, isPriceForEodDate, mapEodCoverage } from "../../src/lib/predictions/eod-universe";
import { runDailyEodMaintenance } from "../../src/lib/predictions/eod-prices";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

const graph = JSON.parse(readFileSync(new URL("../../data/ai-supply-chain/ai-us.json", import.meta.url), "utf8")) as KnowledgeGraph;
const ordinary = { market: "US" as const, loadPrices: true, manualTickers: [], predictionTickers: [] };
test("US price universe includes every current map company with no predictions, including ADRs", async () => {
  const result = await loadEodPriceUniverse(ordinary, async () => graph);
  assert.equal(result.mapTickers.length, 67);
  assert.deepEqual(result.requestedTickers, result.mapTickers);
  assert.ok(result.mapTickers.includes("TSM"));
  assert.ok(result.mapTickers.includes("P"));
  const expanded = await loadEodPriceUniverse({ ...ordinary, predictionTickers: ["NVDA", "nvda", "XYZ"] }, async () => ({ ...graph, nodes: [...graph.nodes, { id: "US:BRK.B", kind: "COMPANY", order: 999 }] }));
  assert.ok(expanded.requestedTickers.includes("BRK.B"));
  assert.ok(expanded.requestedTickers.includes("XYZ"));
  assert.equal(expanded.requestedTickers.filter(t => t === "NVDA").length, 1);
});
test("China price universe includes every A-share map company plus prediction tickers, never US nodes", async () => {
  const cn = JSON.parse(readFileSync(new URL("../../data/ai-supply-chain/ai-cn-a.json", import.meta.url), "utf8")) as KnowledgeGraph;
  const combined = { ...graph, nodes: [...graph.nodes, ...cn.nodes] };
  const china = await loadEodPriceUniverse({ ...ordinary, market: "CN_A", predictionTickers: ["XSHE:000001"] }, async () => combined);
  assert.equal(china.mapTickers.length, 62);
  assert.ok(china.mapTickers.every(id => /^(XSHG|XSHE):/.test(id)));
  assert.ok(china.requestedTickers.includes("XSHE:000001") && china.requestedTickers.includes("XSHG:688981"));
  await assert.rejects(loadEodPriceUniverse({ ...ordinary, market: "CN_A" }, async () => graph), /No CN_A map companies/);
});
test("explicit ticker repairs and mark-only runs keep their scope without loading the graph", async () => {
  const noGraph = async (): Promise<KnowledgeGraph> => { throw new Error("Should not load map"); };
  assert.deepEqual(await loadEodPriceUniverse({ ...ordinary, market: "CN_A", manualTickers: ["XSHG:688041"] }, noGraph), { requestedTickers: ["XSHG:688041"], mapTickers: [] });
  assert.deepEqual(await loadEodPriceUniverse({ ...ordinary, manualTickers: ["AMD"], predictionTickers: ["NVDA"] }, noGraph), { requestedTickers: ["AMD"], mapTickers: [] });
  assert.deepEqual(await loadEodPriceUniverse({ ...ordinary, loadPrices: false, predictionTickers: ["AMD"] }, noGraph), { requestedTickers: ["AMD"], mapTickers: [] });
});
test("unavailable or empty US map cannot silently turn into a prediction-only run", async () => {
  await assert.rejects(loadEodPriceUniverse(ordinary, async () => { throw new Error("Directory unavailable"); }), /Directory unavailable/);
  await assert.rejects(loadEodPriceUniverse(ordinary, async () => ({ ...graph, nodes: [] })), /No US map companies/);
});
test("coverage rejects wrong dates, identities, markets and invalid closes", () => {
  const date = "2026-09-18";
  const valid = { ticker: "AMD", market: "US", tradingDate: date, close: 100 };
  assert.ok(isPriceForEodDate(valid, "AMD", date));
  for (const change of [{ ticker: "NVDA" }, { market: "CN_A" }, { tradingDate: "2026-09-17" }, { close: 0 }, { close: NaN }]) {
    assert.equal(isPriceForEodDate({ ...valid, ...change }, "AMD", date), false);
  }
  const prices = new Map([["AMD", valid], ["NVDA", { ...valid, ticker: "NVDA" }], ["TSM", { ...valid, ticker: "TSM", tradingDate: "2026-09-17" }]]);
  assert.deepEqual(mapEodCoverage(["AMD", "NVDA", "TSM", "AVGO"], date, prices, new Set(["AMD", "TSM"])), { runDate: date, requested: 4, cached: 1, fetched: 1, missing: ["TSM", "AVGO"] });
});

test("the EOD job fetches and persists all 67 map prices with zero predictions, reuses cache, and reports gaps", async t => {
  const previousApp = globalThis.__adminApp;
  const previousToken = process.env.EODHD_API_TOKEN;
  const previousTwelve = process.env.TWELVE_DATA_API_KEY;
  delete process.env.EODHD_API_TOKEN;
  process.env.TWELVE_DATA_API_KEY = "synthetic-test-key";
  t.after(() => {
    globalThis.__adminApp = previousApp;
    if (previousToken === undefined) delete process.env.EODHD_API_TOKEN; else process.env.EODHD_API_TOKEN = previousToken;
    if (previousTwelve === undefined) delete process.env.TWELVE_DATA_API_KEY; else process.env.TWELVE_DATA_API_KEY = previousTwelve;
  });
  const runDate = "2026-09-18";
  const documents = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const recordLog = (line: string) => { if (line.startsWith("{")) events.push(JSON.parse(line)); };
  t.mock.method(console, "info", recordLog);
  t.mock.method(console, "warn", recordLog);
  t.mock.method(console, "error", recordLog);
  const companies = graph.nodes.filter(node => node.kind === "COMPANY").map(node => ({ id: node.id, data: () => ({ name: node.name || node.id, status: "PUBLISHED", aiGraph: { status: "PUBLISHED", stageIds: [], stages: [], memberships: [], sources: [], order: node.order, asOf: runDate } }) }));
  const db = {
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({ getAll: (...refs: {get: () => unknown}[]) => Promise.all(refs.map(ref => ref.get())), get: (ref: { get: () => unknown }) => ref.get(), set: (ref: { set: (v: unknown) => unknown }, value: unknown) => ref.set(value) }),
    collection: (name: string) => {
      const query = { where: () => query, orderBy: () => query, limit: () => query,
        get: async () => ({ docs: name === "companies" ? companies : [], empty: name !== "companies", size: name === "companies" ? companies.length : 0 }),
        doc: (id: string) => ({ firestore: db, get: async () => ({ exists: documents.has(`${name}/${id}`), data: () => documents.get(`${name}/${id}`), get: (key: string) => documents.get(`${name}/${id}`)?.[key] }),
          create: async (value: Record<string, unknown>) => { documents.set(name + "/" + id, value); },
          update: async (value: Record<string, unknown>) => { documents.set(name + "/" + id, { ...documents.get(name + "/" + id), ...value }); },
          set: async (value: Record<string, unknown>) => { documents.set(`${name}/${id}`, { ...documents.get(`${name}/${id}`), ...value }); } }),
      };
      return query;
    },
  };
  globalThis.__adminApp = { firestore: () => db } as unknown as NonNullable<typeof globalThis.__adminApp>;
  const requested: string[] = [];
  let failTsm = false;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    const tickers = new URL(url).searchParams.get("symbol")!.split(",");
    requested.push(...tickers);
    return Response.json(Object.fromEntries(tickers.map(ticker => [ticker, failTsm && ticker === "TSM" ? { status: "error", message: "Synthetic unavailable price" } : {
      values: [{ datetime: runDate, open: "99", high: "101", low: "98", close: "100", volume: "1000" }],
    }])));
  });
  const first = await runDailyEodMaintenance({ market: "US", runDate, limit: 1 });
  assert.equal(first.candidatePredictions, 0);
  assert.equal(new Set(requested).size, 67);
  assert.equal(first.priceLoad.loaded, 67);
  assert.deepEqual(first.priceLoad.mapCoverage, { runDate, requested: 67, cached: 0, fetched: 67, missing: [] });
  assert.equal([...documents.keys()].filter(key => key.startsWith("eod_prices/")).length, 67);
  assert.deepEqual((documents.get(`eod_runs/US_${runDate}`)?.priceLoad as { mapCoverage: unknown } | undefined)?.mapCoverage, first.priceLoad.mapCoverage);
  const second = await runDailyEodMaintenance({ market: "US", runDate, limit: 1 });
  assert.equal(requested.length, 67);
  assert.equal(second.priceLoad.mapCoverage?.cached, 67);
  documents.delete(`eod_prices/US_TSM_${runDate}`);
  failTsm = true;
  const third = await runDailyEodMaintenance({ market: "US", runDate, limit: 1 });
  assert.deepEqual(third.priceLoad.mapCoverage?.missing, ["TSM"]);
  assert.equal(third.priceLoad.failed, 1);
  assert.ok(events.some(event => event.severity === "ERROR" && String(event.message).endsWith("map_price_coverage") && (event.missing as string[]).includes("TSM")));
  documents.set("eod_runs/_active_US", { leaseOwner: "scheduled-run", leaseExpiresAtMs: Date.now() + 60_000 });
  const callsBefore = requested.length;
  await assert.rejects(runDailyEodMaintenance({ market: "US", runDate, trigger: "admin", requestedBy: "admin-1" }), { code: "EOD_ALREADY_RUNNING" });
  assert.equal(requested.length, callsBefore);
  assert.equal(documents.get("eod_runs/_active_US")?.leaseOwner, "scheduled-run");
});
