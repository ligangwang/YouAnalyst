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
