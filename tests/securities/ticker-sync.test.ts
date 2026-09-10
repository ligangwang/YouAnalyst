import assert from "node:assert/strict";
import { test } from "node:test";
import { runTickerCatalogSync } from "../../src/lib/tickers/sync-tickers";

test("default ticker sync includes US depositary receipts and preserves market restrictions", async (t) => {
  const listing = (symbol: string, type: string, overrides = {}) => ({
    symbol, type, name: symbol, country: "United States", currency: "USD",
    exchange: "NYSE", mic_code: "XNYS", ...overrides,
  });
  const data = [
    listing("TSM", "American Depositary Receipt"),
    listing("DR", "Depositary Receipt"),
    listing("MRVL", "Common Stock"),
    listing("SPY", "ETF"),
    listing("2330", "Common Stock", { country: "Taiwan", currency: "TWD" }),
    listing("FOREIGN", "Depositary Receipt", { country: "Germany" }),
    listing("NONUSD", "American Depositary Receipt", { currency: "EUR" }),
    listing("PREF", "Preferred Stock"),
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json({ data }));

  const result = await runTickerCatalogSync();
  assert.equal(result.dryRun, true);
  assert.equal(result.written, 0);
  assert.equal(result.filteredCount, 4);
  assert.deepEqual(result.sample.map((item) => item.symbol), ["TSM", "DR", "MRVL", "SPY"]);
  assert.equal(result.sample[0].id, "TSM_XNYS");

  const restricted = await runTickerCatalogSync({ types: ["Common Stock", "ETF"] });
  assert.deepEqual(restricted.sample.map((item) => item.symbol), ["MRVL", "SPY"]);
});
