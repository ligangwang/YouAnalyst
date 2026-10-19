import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { DEFAULT_COMPARE_APPEARANCE, companyCompareColor, parseCompareAppearance, parseCompanyColors } from "../src/lib/compare-appearance";
import { comparePath, parseCompareConfig } from "../src/lib/compare";
import { compareEmbedPath } from "../src/lib/compare-embed";
import { GET, PATCH } from "../src/app/api/preferences/compare/route";

test("colors stay with companies when stocks are reordered, removed, or added", () => {
  assert.equal(new Set(["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "INTC"].map(symbol => companyCompareColor(symbol))).size, 10);
  const first = ["AAPL", "NVDA", "XSHG:600519"].map(symbol => [symbol, companyCompareColor(symbol)]);
  const reordered = Object.fromEntries(["XSHG:600519", "MSFT", "AAPL", "NVDA"].map(symbol => [symbol, companyCompareColor(symbol)]));
  for (const [symbol, color] of first) assert.equal(reordered[symbol], color);
  const customized = { ...DEFAULT_COMPARE_APPEARANCE, companyColors: { AAPL: "#123456" } };
  for (const template of ["classic", "pastel", "contrast"] as const) {
    for (const light of [false, true]) assert.equal(companyCompareColor("AAPL", { ...customized, template }, light), "#123456");
  }
});

test("account appearance validates templates, symbols, colors and bounded storage", () => {
  assert.deepEqual(parseCompareAppearance(DEFAULT_COMPARE_APPEARANCE), DEFAULT_COMPARE_APPEARANCE);
  assert.equal(parseCompareAppearance({ ...DEFAULT_COMPARE_APPEARANCE, template: "anything" }), null);
  assert.equal(parseCompareAppearance({ ...DEFAULT_COMPARE_APPEARANCE, style: "pie" }), null);
  for (const colors of [[], null, { AAPL: "red" }, { AAPL: "#123" }, { "US:AAPL": "#123456" }, { AAPL: "url(https://example.com)" }]) assert.equal(parseCompanyColors(colors), null);
  assert.deepEqual(parseCompanyColors({ AAPL: "#ABCDEF" }), { AAPL: "#abcdef" });
  assert.equal(parseCompanyColors(Object.fromEntries(Array.from({ length: 251 }, (_, i) => [`T${i}`, "#123456"]))), null);
});

test("share and embed links reproduce chosen colors without account access", () => {
  const config = { symbols: ["AAPL", "XSHG:600519"], start: "2025-01-01", end: "2025-12-31", style: "bar" as const, colors: { AAPL: "#123456", "XSHG:600519": "#abcdef" } };
  for (const path of [comparePath(config), compareEmbedPath(config, "light")]) assert.deepEqual(parseCompareConfig(new URL(path, "https://example.com").searchParams), config);
  for (const colors of ["123456", "123456,javascript:alert(1)", "123456,abcdef,123456"]) {
    assert.equal(parseCompareConfig(new URLSearchParams({ symbols: "AAPL,NVDA", colors })).colors, undefined);
  }
});

test("comparison preference reads and writes require authentication", async () => {
  for (const [handler, method] of [[GET, "GET"], [PATCH, "PATCH"]] as const) {
    const response = await handler(new NextRequest("https://example.com/api/preferences/compare", { method }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});
