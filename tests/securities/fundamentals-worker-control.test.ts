import assert from "node:assert/strict";
import test from "node:test";
import type { Bucket } from "@google-cloud/storage";
import { encode } from "../../src/lib/central-cache/codec";
import { acquireWorker, bucketWorkerControl, releaseWorker } from "../../src/lib/fundamentals/worker-control";

test("competing generations cannot double-acquire a worker or release a recovered task", async () => {
  let generation = 1;
  let bytes = Buffer.from(JSON.stringify(encode({ cursor: "AMD", manualRequestedBy: "operator" })));
  let conflicts = 0;
  const bucket = {
    file: (_name: string, options?: { generation: string }) => ({
      getMetadata: async () => [{ generation }],
      download: async () => {
        if (options?.generation !== String(generation)) throw Object.assign(Error("generation replaced"), { code: 404 });
        return [bytes];
      },
      save: async (body: string, opt: { preconditionOpts: { ifGenerationMatch: string } }) => {
        if (opt.preconditionOpts.ifGenerationMatch !== String(generation)) {
          conflicts++;
          throw Object.assign(Error("precondition"), { code: 412 });
        }
        generation++;
        bytes = Buffer.from(body);
      },
    }),
  };
  const control = bucketWorkerControl(bucket as unknown as Bucket, "sec");
  const task = { execution: "job", index: 1, attempt: 0 };
  const results = await Promise.all(["one", "two"].map(owner => acquireWorker(control, owner, 1000, task)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(conflicts, 1);
  const original = await control.read();
  assert.equal(await acquireWorker(control, "unrelated", 1001, { ...task, index: 2, attempt: 1 }), null);
  assert.ok(await acquireWorker(control, "retry", 1002, { ...task, attempt: 1 }));
  await releaseWorker(control, original.leaseOwner);
  assert.equal((await control.read()).leaseOwner, "retry");
  await releaseWorker(control, "retry");
  assert.deepEqual(await control.read(), { cursor: "AMD", manualRequestedBy: "operator" });
});
