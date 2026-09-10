import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";

test("explicit language overrides cookie without changing market or company", () => {
  const request = new NextRequest("https://youanalyst.com/map?market=CN_A&company=688041&lang=zh-CN", { headers: { cookie: "ya-language=en", "x-ya-language": "fake" } });
  const response = proxy(request);
  assert.equal(response.headers.get("x-middleware-request-x-ya-language"), "zh-CN");
  assert.equal(response.cookies.get("ya-language")?.value, "zh-CN");
  assert.equal(response.headers.get("location"), null);
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
