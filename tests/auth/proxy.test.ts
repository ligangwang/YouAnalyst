import assert from "node:assert/strict";
import { test } from "node:test";
import { proxyAuthRequest } from "../../src/lib/firebase/auth-proxy";

test("auth proxy forwards only approved endpoints and preserves Firebase errors and refresh bodies", async (t) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ error: { message: "EMAIL_EXISTS" } }, { status: 400 });
  });
  for (const [path, body, contentType, host] of [
    ["identity/v1/accounts:signUp", '{"email":"test@example.com","password":"test-password"}', "application/json", "identitytoolkit.googleapis.com"],
    ["token/v1/token", "grant_type=refresh_token&refresh_token=example", "application/x-www-form-urlencoded", "securetoken.googleapis.com"],
  ]) {
    const response = await proxyAuthRequest(new Request(`https://youanalyst.com/api/firebase-auth/${path}?key=attacker-key`, {
      method: "POST", body, headers: { "content-type": contentType, cookie: "private=cookie", authorization: "Bearer private", origin: "https://youanalyst.com" },
    }), path.split("/"), "project-key");
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: { message: "EMAIL_EXISTS" } });
    const call = calls.at(-1)!;
    assert.equal(call.url.hostname, host);
    assert.equal(call.url.searchParams.get("key"), "project-key");
    assert.equal(call.init.body, body);
    assert.equal(new Headers(call.init.headers).get("cookie"), null);
    assert.equal(new Headers(call.init.headers).get("authorization"), null);
    assert.equal(new Headers(call.init.headers).get("content-type"), contentType);
  }
});

test("invalid routes, methods, origins and oversized bodies never reach upstream", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const url = "https://youanalyst.com/api/firebase-auth/identity/v1/accounts:signUp";
  for (const [request, path, status] of [
    [new Request(url), ["identity", "v1", "accounts:delete"], 404],
    [new Request(url), ["identity", "v1", "accounts:signUp"], 405],
    [new Request(url, { method: "POST", headers: { origin: "https://evil.example" } }), ["identity", "v1", "accounts:signUp"], 403],
    [new Request(url, { method: "POST", body: "x".repeat(32_769) }), ["identity", "v1", "accounts:signUp"], 413],
  ] as const) {
    assert.equal((await proxyAuthRequest(request, [...path], "key")).status, status);
  }
  assert.equal(mock.mock.callCount(), 0);
});

test("upstream network failures return a private, sanitized error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("sensitive upstream details"); });
  const response = await proxyAuthRequest(new Request("https://youanalyst.com/api/firebase-auth/token/v1/token", { method: "POST", body: "refresh_token=secret" }), ["token", "v1", "token"], "key");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: { message: "INTERNAL_ERROR" } });
});
