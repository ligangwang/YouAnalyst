import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import { languageUrl } from "../../src/lib/i18n/urls";

const request = (path: string, cookie = "") => new NextRequest(`https://youanalyst.com${path}`, { headers: { host: "youanalyst.com", cookie } });
test("legacy graph links preserve company and market without redirect loops", () => {
  const response = proxy(request("/map?lang=zh-CN&market=CN_A&company=XSHG%3A688041"));
  const url = new URL(response.headers.get("location")!);
  assert.equal(url.pathname, "/zh-cn");
  assert.equal(url.searchParams.get("company"), "XSHG:688041");
  assert.equal(url.searchParams.get("market"), "CN_A");
  const next = proxy(request(url.pathname + url.search));
  assert.equal(next.headers.get("location"), null);
  assert.equal(new URL(next.headers.get("x-middleware-rewrite")!).pathname, "/");
});
test("explicit language path overrides visitor cookie and forwards locale", () => {
  const response = proxy(request("/zh-cn/ticker/XSHG%3A688041", "ya-language=en"));
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-request-x-ya-language"), "zh-CN");
});
test("default graph removes redundant ALL and keeps filing explorer", () => {
  assert.equal(new URL(proxy(request("/en?market=ALL")).headers.get("location")!).pathname, "/en");
  assert.equal(new URL(proxy(request("/en/map?view=filings&company=AMD")).headers.get("x-middleware-rewrite")!).pathname, "/map");
  assert.equal(new URL(proxy(request("/en?view=filings&company=AMD")).headers.get("location")!).pathname, "/en/map");
  assert.equal(proxy(request("/en/map?view=filings&company=AMD")).headers.get("x-middleware-request-x-ya-pathname"), "/map?view=filings");
});
test("auth, API, admin and assets keep their existing routes", () => {
  for (const path of ["/auth?next=%2Fpredictions", "/api/firebase-auth/identity/accounts:signUp", "/api/firebase-auth/token/token", "/admin", "/_next/static/chunk.js", "/sitemap.xml", "/robots.txt"]) {
    const response = proxy(request(path, "ya-language=zh-CN"));
    assert.equal(response.headers.get("location"), null, path);
    assert.equal(response.headers.get("x-middleware-rewrite"), null, path);
  }
});
test("language changes preserve market, selected company and search", () => {
  const url = languageUrl(new URL("https://youanalyst.com/en?market=CN_A&company=XSHG%3A688041&q=chip"), "zh-CN");
  assert.equal(url.pathname, "/zh-cn");
  assert.equal(url.searchParams.get("company"), "XSHG:688041");
  assert.equal(url.searchParams.get("market"), "CN_A");
  assert.equal(url.searchParams.get("q"), "chip");
});

test("standalone redirects and rewrites retain the original loopback origin", () => {
  const previous = process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
  process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = "true";
  try {
    const origin = "http://127.0.0.1:3187";
    const redirect = proxy(new NextRequest(`${origin}/ticker/688041?lang=zh-CN`));
    assert.equal(new URL(redirect.headers.get("location")!).origin, origin);
    const rewrite = proxy(new NextRequest(`${origin}/zh-cn/ticker/XSHG:688041`));
    assert.equal(new URL(rewrite.headers.get("x-middleware-rewrite")!).origin, origin);
  } finally {
    if (previous === undefined) delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
    else process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = previous;
  }
});
