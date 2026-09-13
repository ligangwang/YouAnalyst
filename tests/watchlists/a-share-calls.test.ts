import { test } from "node:test";
import assert from "node:assert/strict";
import { predictionInstrument, chinaTargetDate, marketDate, formatCallPrice } from "../../src/lib/predictions/instrument";
import { validateCreatePredictionInput } from "../../src/lib/predictions/service";
import { fetchChinaEodPrices, scanEodPredictions } from "../../src/lib/predictions/eod-prices";
import type { Firestore } from "firebase-admin/firestore";

test("A-share calls preserve exchange identity while US calls keep their existing symbol", () => {
  for (const [ticker, provider] of [["XSHG:600584", "600584.SHG"], ["XSHE:002837", "002837.SHE"]]) {
    assert.equal(predictionInstrument(ticker)?.providerSymbol, provider);
    assert.equal(validateCreatePredictionInput({ ticker, direction: "UP", watchlistId: "default" }).ticker, ticker);
    assert.match(formatCallPrice(21.5, ticker), /CN¥21\.50/);
  }
  assert.equal(predictionInstrument("AMD")?.providerSymbol, "AMD.US");
  assert.equal(formatCallPrice(21.5, "AMD"), "$21.50");
  for (const ticker of ["ORG:OPENAI", "XSHG:002837", "XSHE:600584", "US:../AMD", "../../AMD"]) {
    assert.equal(predictionInstrument(ticker), null);
    assert.throws(() => validateCreatePredictionInput({ ticker, direction: "UP", watchlistId: "default" }));
  }
});

test("Chinese target dates follow Shanghai time and never use a close already known at submission", () => {
  assert.equal(chinaTargetDate(new Date("2026-09-14T06:59:59Z")), "2026-09-14");
  assert.equal(chinaTargetDate(new Date("2026-09-14T07:00:00Z")), "2026-09-15");
  assert.equal(marketDate("CN_A", new Date("2026-09-14T00:00:00Z")), "2026-09-14");
  assert.equal(marketDate("US", new Date("2026-09-14T00:00:00Z")), "2026-09-13");
});

test("market scans paginate past another market without consuming its processing limit", async () => {
  const docs = Array.from({ length: 502 }, (_, i) => {
    const data = { userId: "owner", ticker: i < 500 ? "AMD" : "XSHG:600584", status: "CREATED", direction: "UP", entryTargetDate: "2026-09-11" };
    return { id: String(i), ref: {}, data: () => data };
  });
  const query = (offset = 0) => ({
    where: () => query(offset), orderBy: () => query(offset), limit: () => query(offset),
    startAfter: (doc: { id: string }) => query(Number(doc.id) + 1),
    get: async () => ({ docs: docs.slice(offset, offset + 500), size: Math.min(500, docs.length - offset), empty: offset >= docs.length }),
  });
  const db = { collection: () => query() } as unknown as Firestore;
  const china = await scanEodPredictions(db, "2026-09-11", 1, [], "CN_A");
  assert.equal(china.predictionsToProcess.length, 1);
  assert.equal(china.predictionsToProcess[0].ticker, "XSHG:600584");
  assert.equal(china.scannedCandidatePredictions, 502);
  const us = await scanEodPredictions(db, "2026-09-11", 1, [], "US");
  assert.equal(us.predictionsToProcess[0].ticker, "AMD");
});

test("China EOD uses exact dated SHG/SHE bars, adjusted close, and never a US fallback", async t => {
  const oldToken = process.env.EODHD_API_TOKEN;
  process.env.EODHD_API_TOKEN = "isolated-test-token";
  t.after(() => { if (oldToken === undefined) delete process.env.EODHD_API_TOKEN; else process.env.EODHD_API_TOKEN = oldToken; });
  const paths: string[] = [];
  let mode = "valid";
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    paths.push(url.pathname);
    assert.equal(url.searchParams.get("from"), "2026-09-11");
    assert.equal(url.searchParams.get("to"), "2026-09-11");
    if (mode === "denied") return new Response("No access", { status: 403 });
    return Response.json([{ date: mode === "holiday" ? "2026-09-10" : "2026-09-11", open: 22, high: 23, low: 21, close: 22, adjusted_close: 21.5, volume: 100 }]);
  });
  const result = await fetchChinaEodPrices(["XSHG:600584", "XSHE:002837"], "2026-09-11", "2026-09-11T12:00:00Z");
  assert.deepEqual(paths.sort(), ["/api/eod/002837.SHE", "/api/eod/600584.SHG"]);
  assert.equal(result.prices.length, 2);
  assert.ok(result.prices.every(p => p.market === "CN_A" && p.close === 21.5 && p.exchangeTimezone === "Asia/Shanghai"));
  mode = "holiday";
  assert.equal((await fetchChinaEodPrices(["XSHG:600584"], "2026-09-11", "now")).prices.length, 0);
  mode = "denied";
  assert.deepEqual((await fetchChinaEodPrices(["XSHG:600584"], "2026-09-11", "now")).failures, [{ ticker: "XSHG:600584", reason: "eodhd_http_403" }]);
});
