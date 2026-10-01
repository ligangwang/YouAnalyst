import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createJobSubscriber } from "../../src/lib/job-pubsub-server";

test("shared push handler validates routing and acknowledges only successful processing", async t => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {});
  let calls = 0, failed = false;
  const server = createJobSubscriber({ project: "demo", subscription: "worker", job: "fixture",
    parse: (value: unknown) => { const v = value as { batchId?: string }; if (v?.batchId !== "valid") throw Error("invalid payload"); return { batchId: v.batchId }; },
    process: async () => { calls++; if (failed) throw Error("retry me"); return { completed: 1 }; },
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const body = (batchId = "valid", subscription = "projects/demo/subscriptions/worker") => JSON.stringify({ subscription,
    message: { data: Buffer.from(JSON.stringify({ batchId })).toString("base64") } });
  const post = (body: string) => fetch(`${url}/pubsub`, { method: "POST", body });
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/pubsub`)).status, 404);
  for (const invalid of ["null", "not json", body("invalid"), body("valid", "projects/other/subscriptions/worker")]) {
    assert.equal((await post(invalid)).status, 503);
  }
  assert.equal(calls, 0);
  assert.equal((await post(body())).status, 204);
  failed = true;
  assert.equal((await post(body())).status, 503);
  assert.equal(calls, 2);
});

test("additional subscriptions use their own parser and reject cross-topic payloads", async t => {
  t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {});
  const parse = (kind: string) => (value: unknown) => {
    const input = value as { batchId?: string; type?: string };
    if (input?.type !== kind || !input.batchId) throw Error("Wrong event type for subscription");
    return { batchId: input.batchId, type: kind };
  };
  const calls: string[] = [];
  const server = createJobSubscriber({ project: "demo", subscription: "requests", job: "fixture",
    parse: parse("request"), additionalSubscriptions: [{ subscription: "filings", parse: parse("filing") }],
    process: async request => { calls.push(request.type); return { completed: 1 }; } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = (subscription: string, type: string) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/pubsub`, {
    method: "POST", body: JSON.stringify({ subscription: `projects/demo/subscriptions/${subscription}`,
      message: { data: Buffer.from(JSON.stringify({ batchId: "test", type })).toString("base64") } }) });
  assert.equal((await post("requests", "request")).status, 204);
  assert.equal((await post("filings", "filing")).status, 204);
  assert.equal((await post("requests", "filing")).status, 503);
  assert.equal((await post("filings", "request")).status, 503);
  assert.equal((await post("unknown", "request")).status, 503);
  assert.deepEqual(calls, ["request", "filing"]);
  assert.throws(() => createJobSubscriber({ project: "demo", subscription: "same", job: "fixture", parse: parse("request"),
    additionalSubscriptions: [{ subscription: "same", parse: parse("filing") }], process: async () => ({}) }), /Duplicate/);
});
