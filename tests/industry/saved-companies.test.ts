import assert from "node:assert/strict";
import { test } from "node:test";
import { createSavedCompanyHandlers, mapAuthCompany, mapSignInHref, savedCompanyTickers } from "../../src/lib/industry-graph/saved-companies";

function fixture() {
  const records = new Map<string, string[]>([["alice", ["MU"]], ["bob", ["TSM"]]]);
  const calls: string[] = [];
  const handlers = createSavedCompanyHandlers({
    authenticate: async (request: Request) => request.headers.get("authorization") === "Bearer test-alice" ? { uid: "alice" } : null,
    read: async (uid) => { calls.push(uid); return records.get(uid); },
    update: async (uid, ticker, saved) => {
      calls.push(uid);
      const tickers = new Set(records.get(uid));
      if (saved) tickers.add(ticker); else tickers.delete(ticker);
      records.set(uid, [...tickers]);
      return [...tickers];
    },
  });
  return { records, calls, handlers };
}
function request(body?: unknown, authenticated = true) {
  return new Request("https://example.invalid/api/industry-graph/saved?userId=bob", {
    method: body === undefined ? "GET" : "POST",
    headers: authenticated ? { authorization: "Bearer test-alice" } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("anonymous reads and mutations never reach storage", async () => {
  const { handlers, calls } = fixture();
  for (const response of [await handlers.GET(request(undefined, false)), await handlers.POST(request({ ticker: "AMD", saved: true }, false))]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(calls, []);
});
test("token ownership wins over supplied user IDs for both reads and writes", async () => {
  const { handlers, records, calls } = fixture();
  assert.deepEqual(await (await handlers.GET(request())).json(), { tickers: ["MU"] });
  const response = await handlers.POST(request({ ticker: "NVDA", saved: true, userId: "bob" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { tickers: ["MU", "NVDA"] });
  assert.deepEqual(records.get("bob"), ["TSM"]);
  assert.deepEqual(calls, ["alice", "alice"]);
});
test("invalid bodies and unsupported companies cannot reach writes", async () => {
  const { handlers, calls } = fixture();
  for (const input of [null, [], { ticker: "../../bob", saved: true }, { ticker: "NVDA", saved: "true" }, { ticker: "UNKNOWN", saved: true }]) {
    assert.equal((await handlers.POST(request(input))).status, 400);
  }
  const malformed = new Request("https://example.invalid", { method: "POST", headers: { authorization: "Bearer test-alice" }, body: "{" });
  assert.equal((await handlers.POST(malformed)).status, 400);
  assert.deepEqual(calls, []);
});
test("explicit desired state makes save/remove retries idempotent", async () => {
  const { handlers } = fixture();
  for (const saved of [true, true, false, false]) {
    const response = await handlers.POST(request({ ticker: "AMD", saved }));
    assert.deepEqual(await response.json(), { tickers: saved ? ["MU", "AMD"] : ["MU"] });
  }
});
test("storage failures return a private retryable response without internal details", async () => {
  const fail = async () => { throw new Error("private database details"); };
  const handlers = createSavedCompanyHandlers({ authenticate: async () => ({ uid: "alice" }), read: fail, update: fail });
  for (const response of [await handlers.GET(request()), await handlers.POST(request({ ticker: "MU", saved: true }))]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.doesNotMatch(await response.text(), /private database details/);
  }
});
test("only supported tickers survive storage reads and contextual auth links", () => {
  assert.deepEqual(savedCompanyTickers(["MU", "MU", "TSM", "unknown", null]), ["MU", "TSM"]);
  const next = new URL(mapSignInHref("TSM"), "https://example.invalid").searchParams.get("next");
  assert.equal(next, "/?company=TSM");
  assert.equal(mapAuthCompany(next), "TSM");
  assert.equal(mapAuthCompany("/predictions/new?ticker=TSM"), null);
  assert.equal(mapAuthCompany("/?company=unknown"), null);
});
