import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import { parsePreferences } from "../../src/lib/preferences";
import { translateUi } from "../../src/lib/i18n/translate";

test("explicit language overrides cookie without changing market or company", () => {
  const request = new NextRequest("https://youanalyst.com/map?market=CN_A&company=688041&lang=zh-CN", { headers: { cookie: "ya-language=en", "x-ya-language": "fake" } });
  const response = proxy(request);
  assert.equal(response.headers.get("x-middleware-request-x-ya-language"), "zh-CN");
  assert.equal(response.cookies.get("ya-language")?.value, "zh-CN");
  assert.equal(response.headers.get("location"), null);
});
test("market and language preferences remain independent and reject unsupported markets", () => {
  assert.deepEqual(parsePreferences({ language: "en", market: "CN_A" }), { language: "en", market: "CN_A" });
  assert.deepEqual(parsePreferences({ language: "zh-CN", market: "ALL" }), { language: "zh-CN", market: "ALL" });
  assert.equal(parsePreferences({ language: "zh-CN", market: "HK" }), null);
  assert.deepEqual(parsePreferences({ language: "en", market: "US", uid: "someone-else", isAdmin: true }), { language: "en", market: "US" });
  const response = proxy(new NextRequest("https://youanalyst.com/?market=ALL", { headers: { cookie: "ya-language=zh-CN; ya-market=US", "x-ya-market": "CN_A" } }));
  assert.equal(response.headers.get("x-middleware-request-x-ya-market"), "ALL");
  assert.equal(response.headers.get("x-middleware-request-x-ya-language"), "zh-CN");
  assert.equal(response.cookies.get("ya-market")?.value, "ALL");
  const invalid = proxy(new NextRequest("https://youanalyst.com/?market=HK", { headers: { cookie: "ya-market=CN_A", "x-ya-market": "ALL" } }));
  assert.equal(invalid.headers.get("x-middleware-request-x-ya-market"), "CN_A");
});
test("authored UI translations retain English, entities, numbers and company identifiers", () => {
  assert.equal(translateUi("Latest Calls", "zh-CN"), "最新观点");
  assert.equal(translateUi("Latest Calls", "en"), "Latest Calls");
  assert.equal(translateUi(" since call (133d)", "zh-CN"), " 自发布以来（133天）");
  assert.equal(translateUi(" since call (133d)", "en"), " since call (133d)");
  assert.equal(translateUi("&middot;", "en"), "·");
  assert.equal(translateUi("Up prediction for AMD", "zh-CN"), "AMD 的看多观点");
  assert.equal(translateUi("Title must be 120 characters or fewer.", "zh-CN"), "标题不得超过 120 个字符。");
  assert.equal(translateUi("NVDA supplies AMD", "zh-CN"), "NVDA 向 AMD 供货");
  assert.equal(translateUi("An original user thesis", "zh-CN"), "An original user thesis");
});
test("saved language persists and invalid query or injected header cannot set a locale", () => {
  const saved = proxy(new NextRequest("https://youanalyst.com/map?lang=invalid", { headers: { cookie: "ya-language=zh-CN" } }));
  assert.equal(saved.headers.get("x-middleware-request-x-ya-language"), "zh-CN");
  const fallback = proxy(new NextRequest("https://youanalyst.com/", { headers: { "x-ya-language": "zh-CN" } }));
  assert.equal(fallback.headers.get("x-middleware-request-x-ya-language"), "en");
});
test("canonical host redirect preserves language and market", () => {
  const response = proxy(new NextRequest("https://www.youanalyst.com/map?market=CN_A&lang=zh-CN", { headers: { host: "www.youanalyst.com" } }));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://youanalyst.com/map?market=CN_A&lang=zh-CN");
});
