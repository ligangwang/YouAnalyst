import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

const script = buildSync({ entryPoints: ["src/lib/company-follow-intent.ts"], bundle: true, write: false, format: "iife", globalName: "follow" }).outputFiles[0].text;

function setup(enabled = true, cookie = "", confirmed = true) {
  const calls: unknown[][] = [];
  let writes = 0;
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const context = {
    window: { gtag: (...args: unknown[]) => calls.push(args), dispatchEvent() {} },
    document: { cookie, querySelector: () => ({ getAttribute: () => enabled ? "enabled" : "disabled" }) },
    localStorage: { getItem: () => null, setItem() {} },
    Event, AbortSignal,
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: async () => { writes++; return { ok: confirmed, json: async () => ({ companyIds: ["US:AMD"] }) }; },
  };
  return { context, calls, timers, writes: () => writes };
}

test("follow intent is separate from persistence and sends no company or destination", () => {
  const env = setup();
  runInNewContext(script + "; follow.trackCompanyFollowIntent();", env.context);
  assert.equal(env.writes(), 0);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0][1], "company_follow_intent");
  assert.deepEqual(Object.keys(env.calls[0][2] as object).sort(), ["entry_point", "graph_origin", "graph_version", "surface"]);
});

test("intent honors disabled collection and opt-out", () => {
  for (const [enabled, cookie] of [[false, ""], [true, "youanalyst_analytics_opt_out=1"]] as const) {
    const env = setup(enabled, cookie);
    runInNewContext(script + "; follow.trackCompanyFollowIntent();", env.context);
    assert.equal(env.calls.length, 0);
  }
});

test("persistence emits completion only on success and never another intent", async () => {
  for (const confirmed of [false, true]) {
    const env = setup(true, "", confirmed);
    const attempt = runInNewContext(script + "; follow.persistCompanyFollow('US:AMD', true, async () => 'isolated-token');", env.context);
    if (confirmed) await attempt; else await assert.rejects(attempt);
    assert.equal(env.writes(), 1);
    assert.deepEqual(env.calls.map(c => c[1]), confirmed ? ["company_follow"] : []);
  }
});


test("signed-out navigation waits for a queued intent callback", async () => {
  const env = setup();
  let navigated = false;
  const pending = runInNewContext(script + "; follow.waitForCompanyFollowIntent();", env.context).then(() => { navigated = true; });
  await Promise.resolve();
  assert.equal(navigated, false);
  assert.equal(env.calls.length, 1);
  const payload = env.calls[0][2] as { event_callback: () => void; event_timeout: number };
  assert.equal(payload.event_timeout, 500);
  payload.event_callback();
  await pending;
  assert.equal(navigated, true);
  assert.equal(env.timers.size, 0);
  assert.equal(env.calls.length, 1);
});

test("navigation is released by the fallback timer if the tag never loads", async () => {
  const env = setup();
  let navigated = false;
  const pending = runInNewContext(script + "; follow.waitForCompanyFollowIntent();", env.context).then(() => { navigated = true; });
  await Promise.resolve();
  assert.equal(navigated, false);
  assert.equal(env.timers.size, 1);
  env.timers.values().next().value!();
  await pending;
  assert.equal(navigated, true);
  (env.calls[0][2] as { event_callback: () => void }).event_callback();
  assert.equal(env.calls.length, 1);
});

test("disabled or opted-out analytics releases navigation immediately", async () => {
  for (const [enabled, cookie] of [[false, ""], [true, "youanalyst_analytics_opt_out=1"]] as const) {
    const env = setup(enabled, cookie);
    await runInNewContext(script + "; follow.waitForCompanyFollowIntent();", env.context);
    assert.equal(env.calls.length, 0);
    assert.equal(env.timers.size, 0);
  }
});

test("a throwing analytics tag cannot block navigation", async () => {
  const env = setup();
  env.context.window.gtag = () => { throw new Error("blocked"); };
  await runInNewContext(script + "; follow.waitForCompanyFollowIntent();", env.context);
  assert.equal(env.timers.size, 0);
});
