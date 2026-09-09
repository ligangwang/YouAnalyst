import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { analyticsBootstrap } from "../../src/lib/analytics-bootstrap";
import { GET } from "../../src/app/analytics/opt-out/route";

function browser(overrides: { hostname?: string; protocol?: string; webdriver?: boolean; userAgent?: string; cookie?: string; blockedCookies?: boolean } = {}) {
  const scripts: Array<{ src?: string }> = [];
  const meta = { content: "disabled", setAttribute(_key: string, value: string) { this.content = value; }, getAttribute() { return this.content; } };
  const window: Record<string, unknown> = {};
  const document = {
    querySelector: () => meta,
    get cookie() { if (overrides.blockedCookies) throw new Error("Blocked"); return overrides.cookie ?? ""; },
    createElement: () => ({}), head: { appendChild: (script: { src?: string }) => scripts.push(script) },
  };
  const context = { window, document, location: { hostname: overrides.hostname ?? "youanalyst.com", protocol: overrides.protocol ?? "https:" }, navigator: { webdriver: overrides.webdriver ?? false, userAgent: overrides.userAgent ?? "Chrome" } };
  return { context, scripts, meta, window };
}

test("real public-domain visitors retain one initial page configuration and custom events", () => {
  for (const hostname of ["youanalyst.com", "www.youanalyst.com"]) {
    const env = browser({ hostname });
    runInNewContext(analyticsBootstrap("G-TEST123", true), env.context);
    assert.equal(env.scripts.length, 1);
    assert.equal(env.scripts[0].src, "https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    assert.equal(env.meta.content, "enabled");
    const events = env.window.dataLayer as IArguments[];
    assert.equal(events.length, 2);
    assert.equal(events[1][0], "config");
    assert.equal(events[1][1], "G-TEST123");
  }
});

test("excluded traffic never loads Google, queues events, or enables custom events", () => {
  const scenarios = [
    { hostname: "localhost" }, { hostname: "127.0.0.1" },
    { hostname: "ifindata-web-zcgfwde4aa-uc.a.run.app" },
    { hostname: "staging.youanalyst.com" }, { hostname: "youanalyst.com.example.org" },
    { protocol: "http:" }, { webdriver: true }, { userAgent: "Mozilla/5.0 HeadlessChrome/145.0" },
    { cookie: "other=1; youanalyst_analytics_opt_out=1; another=2" }, { blockedCookies: true },
  ];
  for (const scenario of scenarios) {
    const env = browser(scenario);
    runInNewContext(analyticsBootstrap("G-TEST123", true), env.context);
    assert.equal(env.scripts.length, 0, JSON.stringify(scenario));
    assert.equal(env.window.dataLayer, undefined);
    assert.equal(env.window["ga-disable-G-TEST123"], true);
    assert.equal(env.meta.content, "disabled");
  }
});

test("staging and missing or malformed measurement IDs fail closed", () => {
  for (const [id, production] of [["G-TEST123", false], ["", true], ["</script>", true]] as const) {
    const env = browser();
    runInNewContext(analyticsBootstrap(id, production), env.context);
    assert.equal(env.scripts.length, 0);
    assert.equal(env.meta.content, "disabled");
  }
});

test("custom events respect both the collection gate and a newly set opt-out cookie", () => {
  const script = buildSync({ entryPoints: ["src/lib/analytics.ts"], bundle: true, write: false, format: "iife", globalName: "analytics" }).outputFiles[0].text;
  for (const [enabled, cookie, expected] of [[false, "", 0], [true, "youanalyst_analytics_opt_out=1", 0], [true, "", 1]] as const) {
    const env = browser({ cookie });
    env.meta.content = enabled ? "enabled" : "disabled";
    const calls: unknown[] = [];
    env.window.gtag = (...args: unknown[]) => calls.push(args);
    runInNewContext(script + '; analytics.trackEvent("graph_search", {result_count: 3});', env.context);
    assert.equal(calls.length, expected);
  }
});

test("opt-out response is untracked, uncached, and persists across public subdomains", async () => {
  const response = GET(new Request("https://youanalyst.com/analytics/opt-out"));
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /youanalyst_analytics_opt_out=1; Path=\//);
  assert.match(cookie, /Domain=youanalyst.com; Secure/);
  assert.match(cookie, /Max-Age=34560000/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.doesNotMatch(await response.text(), /<script|googletagmanager/);
  const env = browser({ cookie: cookie.split(";")[0] });
  runInNewContext(analyticsBootstrap("G-TEST123", true), env.context);
  assert.equal(env.scripts.length, 0);
});
