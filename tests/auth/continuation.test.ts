import assert from "node:assert/strict";
import { test } from "node:test";
import { isFollowingAuthDestination, safeAuthDestination } from "../../src/lib/auth-continuation";

for (const prefix of ["", "/en", "/zh-cn"]) {
  test(`following auth recognizes research destinations with ${prefix || "no"} locale prefix`, () => {
    for (const path of ["/watchlists/following", "/watchlists/following/", "/feed?scope=following", "/feed/?scope=following&filter=BUSINESS#updates"]) {
      const destination = prefix + path;
      assert.equal(isFollowingAuthDestination(destination), true, destination);
      assert.equal(safeAuthDestination(destination), destination);
    }
  });
}

test("following copy does not replace intentional calls or unrelated account entry points", () => {
  for (const destination of [
    undefined, "", "/", "/?company=AMD", "/feed", "/feed?scope=all",
    "/en/feed?scope=Following", "/en/feed?scope=all&scope=following",
    "/en/feed?scope=following&scope=all", "/en/feed?scope=following&scope=following",
    "/watchlists", "/watchlists/following-other", "/watchlists/following/extra",
    "/predictions/new?ticker=AMD&direction=UP", "/en/predictions/new?ticker=AMD&direction=DOWN",
    "/analysts/someone?next=/watchlists/following", "/feed#scope=following",
  ]) assert.equal(isFollowingAuthDestination(destination), false, String(destination));
});

test("following copy never accepts external or ambiguous continuations", () => {
  for (const destination of [
    "https://evil.example/en/feed?scope=following", "//evil.example/watchlists/following",
    "/\\evil.example/en/watchlists/following", "/\n/evil.example/watchlists/following",
    "/.//evil.example/watchlists/following", "/%2f%2fevil.example/watchlists/following",
    "/%5cevil.example/feed?scope=following", "/%00/feed?scope=following", "/%zz",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeAuthDestination(destination), null, destination);
    assert.equal(isFollowingAuthDestination(destination), false, destination);
  }
});

// Render the actual component/providers without a browser or authentication.
// Effects and event handlers do not execute during server rendering.
async function authHtml(destination: string | undefined, create: boolean, locale: "en" | "zh-CN" = "en") {
  const { createRequire } = await import("node:module");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  // Keep provider and consumer on one module instance on both Node 20 and 24.
  const require = createRequire(import.meta.url);
  const { AuthPage } = require("../../src/components/auth-page") as typeof import("../../src/components/auth-page");
  const { AuthProvider } = require("../../src/components/providers/auth-provider") as typeof import("../../src/components/providers/auth-provider");
  const { LocaleProvider } = require("../../src/components/providers/locale-provider") as typeof import("../../src/components/providers/locale-provider");
  const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime") as typeof import("next/dist/shared/lib/app-router-context.shared-runtime");
  const unexpectedNavigation = () => { throw new Error("Server rendering must not navigate"); };
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, {
    value: { back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation, prefetch: unexpectedNavigation },
  }, createElement(AuthProvider, { children: createElement(LocaleProvider, {
    locale, children: createElement(AuthPage, { requestedNext: destination, initialCreate: create }),
  }) })));
}

for (const create of [true, false]) {
  test(`research ${create ? "signup" : "sign-in"} renders company-saving copy without a call prerequisite`, async () => {
    for (const destination of ["/watchlists/following", "/en/watchlists/following", "/en/feed?scope=following&filter=BUSINESS#updates"]) {
      const html = await authHtml(destination, create);
      assert.match(html, /Keep your research in one place/);
      assert.match(html, /save and follow companies in your private list and track sourced updates/);
      assert.match(html, /No bullish or bearish call required/);
      assert.match(html, /You’ll return to your research after signing in/);
      assert.doesNotMatch(html, /confirm your call|first watchlist is ready automatically|Keep bullish and bearish calls/);
      assert.match(html, create ? /Create account/ : />Sign in</);
    }
    const chinese = await authHtml("/zh-cn/feed?scope=following", create, "zh-CN");
    assert.match(chinese, /保存关注，继续研究/);
    assert.match(chinese, /有来源支持的更新/);
    assert.match(chinese, /无需发表看多或看空判断/);
    assert.doesNotMatch(chinese, /再确认观点|首个自选股列表将自动创建/);
  });
}

test("intentional calls, map saves and specific company follows keep their own copy", async () => {
  for (const direction of ["UP", "DOWN"]) {
    const html = await authHtml(`/predictions/new?ticker=AMD&direction=${direction}`, true);
    assert.match(html, new RegExp(`Track your ${direction === "UP" ? "bullish" : "bearish"} view on AMD`));
    assert.match(html, /Review your call before publishing; creating an account does not publish it/);
    assert.doesNotMatch(html, /No bullish or bearish call required/);
  }
  const map = await authHtml("/?company=AMD", true);
  assert.match(map, /Keep AMD on your map/);
  assert.doesNotMatch(map, /confirm your call/);
  const follow = await authHtml("/en/feed?scope=following&followCompany=US%3AAMD", true);
  assert.match(follow, /Follow AMD/);
  assert.match(follow, /save this company to your private list/);
  assert.doesNotMatch(follow, /confirm your call/);
});
