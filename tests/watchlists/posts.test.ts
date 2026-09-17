import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { publishPost, readPost } from "../../src/lib/posts/service";
import { validatePost } from "../../src/lib/posts/model";
import { choosePrimaryPrediction } from "../../src/lib/predictions/primary";

type Data = Record<string, unknown>;
function fixture(extra: Record<string, Data> = {}) {
  const records = new Map<string, Data>(Object.entries({ "users/alice": { role: "user", settings: { isPublic: true } }, "companies/US:AMD": { status: "PUBLISHED" }, ...extra }));
  let sequence = 0;
  type Ref = { path: string; id: string; filters: Array<[string, unknown]>; where: (field: string, op: string, value: unknown) => Ref; get: () => Promise<unknown> };
  function ref(path: string, filters: Array<[string, unknown]> = []): Ref {
    return { path, id: path.split("/").pop()!, filters, where: (field, _op, value) => ref(path, [...filters, [field, value]]), get: async () => snap(ref(path), records) };
  }
  function snap(r: Ref, working: Map<string, Data>) {
    const data = working.get(r.path);
    return { id: r.id, ref: r, exists: !!data, data: () => data, get: (field: string) => field.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Data)[key] : undefined, data) };
  }
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    collection: (name: string) => ({ ...ref(name), doc: (id = "new" + ++sequence) => ref(name + "/" + id) }),
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const result = tail.then(async () => {
        const working = new Map(records);
        let wrote = false;
        const output = await fn({
          get: async (r: Ref) => {
            assert.equal(wrote, false, "all transaction reads precede writes");
            if (r.path.includes("/")) return snap(r, working);
            return { docs: [...working.entries()].filter(([key, data]) => key.startsWith(r.path + "/") && r.filters.every(([field, value]) => data[field] === value)).map(([path]) => snap(ref(path), working)) };
          },
          set: (r: Ref, data: Data) => { wrote = true; working.set(r.path, data); },
          create: (r: Ref, data: Data) => { wrote = true; assert.equal(working.has(r.path), false); working.set(r.path, data); },
          update: (r: Ref, data: Data) => { wrote = true; working.set(r.path, { ...working.get(r.path), ...data }); },
        });
        records.clear(); for (const [key, data] of working) records.set(key, data);
        return output;
      });
      tail = result.catch(() => {});
      return result;
    },
  } as unknown as Firestore;
  return { db, records };
}
const input = validatePost({ ticker: "AMD", title: "AMD research", body: "Source-backed article", direction: "UP", visibility: "PUBLIC", requestId: "request-1234567890" });
const user = { uid: "alice" };

test("standalone article creates no prediction and retries are idempotent", async () => {
  const f = fixture();
  const a = await publishPost({ ...input, direction: null }, user, f.db);
  const b = await publishPost({ ...input, direction: null }, user, f.db);
  assert.deepEqual(a, b);
  assert.equal(a.predictionId, null);
  assert.equal([...f.records.keys()].filter(k => k.startsWith("predictions/")).length, 0);
  assert.equal([...f.records.keys()].filter(k => k.startsWith("posts/")).length, 1);
});

test("directional publication creates a pending prediction and article atomically", async () => {
  const f = fixture();
  const a = await publishPost(input, user, f.db);
  assert.equal(f.records.get("predictions/" + a.predictionId)?.status, "CREATED");
  assert.equal(f.records.get("predictions/" + a.predictionId)?.entryPrice, null);
  assert.equal(f.records.get("posts/" + a.id)?.predictionId, a.predictionId);
  assert.deepEqual(await publishPost(input, user, f.db), a);
});

test("concurrent articles append to one call without resetting entry history", async () => {
  const f = fixture();
  const results = await Promise.all([input, { ...input, requestId: "request-9876543210" }].map(i => publishPost(i, user, f.db)));
  assert.equal(results[0].predictionId, results[1].predictionId);
  const key = "predictions/" + results[0].predictionId;
  f.records.set(key, { ...f.records.get(key), status: "OPEN", entryPrice: 123, entryDate: "2026-01-01" });
  const before = JSON.stringify(f.records.get(key));
  await publishPost({ ...input, requestId: "request-3333333333" }, user, f.db);
  assert.equal(JSON.stringify(f.records.get(key)), before);
});

test("opposite direction, visibility changes and request ID reuse do not write partial posts", async () => {
  const f = fixture();
  await publishPost(input, user, f.db);
  const before = JSON.stringify([...f.records]);
  await assert.rejects(publishPost({ ...input, direction: "DOWN", requestId: "request-3333333333" }, user, f.db), /opposite direction/);
  await assert.rejects(publishPost({ ...input, visibility: "PRIVATE", requestId: "request-3333333333" }, user, f.db), /same visibility/);
  await assert.rejects(publishPost({ ...input, body: "Changed" }, user, f.db), /different post/);
  assert.equal(JSON.stringify([...f.records]), before);
});

test("missing company cannot publish or create a prediction", async () => {
  const f = fixture();
  f.records.delete("companies/US:AMD");
  await assert.rejects(publishPost(input, user, f.db), /directory/);
  await assert.rejects(publishPost({ ...input, direction: null }, user, f.db), /directory/);
  assert.equal(f.records.size, 1);
});

test("post reads enforce ownership, profile visibility, and linked prediction visibility", async () => {
  const f = fixture();
  const publicPost = await publishPost(input, user, f.db);
  assert.ok(await readPost(publicPost.id, undefined, f.db));
  const predictionKey = "predictions/" + publicPost.predictionId;
  f.records.set(predictionKey, { ...f.records.get(predictionKey), visibility: "PRIVATE" });
  assert.equal(await readPost(publicPost.id, "bob", f.db), null);
  assert.ok(await readPost(publicPost.id, "alice", f.db));
  f.records.set(predictionKey, { ...f.records.get(predictionKey), visibility: "PUBLIC" });
  f.records.set("users/alice", { settings: { isPublic: false } });
  assert.equal(await readPost(publicPost.id, undefined, f.db), null);
  const privatePost = await publishPost({ ...input, requestId: "private-1234567890", direction: null, visibility: "PRIVATE" }, user, f.db);
  assert.equal(await readPost(privatePost.id, "bob", f.db), null);
  assert.ok(await readPost(privatePost.id, "alice", f.db));
});

test("legacy primary selection is owner-only and routes articles without changing either entry", async () => {
  const f = fixture();
  const original = await publishPost(input, user, f.db);
  const originalKey = "predictions/" + original.predictionId;
  f.records.set("predictions/comparison-amd", { ...f.records.get(originalKey), entryPrice: 100, entryDate: "2026-04-01", status: "OPEN" });
  const before = JSON.stringify(f.records.get("predictions/comparison-amd"));
  await assert.rejects(choosePrimaryPrediction(f.db, "bob", "comparison-amd"), /own active/);
  await choosePrimaryPrediction(f.db, "alice", "comparison-amd");
  const article = await publishPost({ ...input, requestId: "update-1234567890" }, user, f.db);
  assert.equal(article.predictionId, "comparison-amd");
  assert.equal(JSON.stringify(f.records.get("predictions/comparison-amd")), before);
  assert.ok(f.records.has(originalKey));
});
