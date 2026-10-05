import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { parsePrivateValuationRequest, processPrivateValuationCheck, publishPrivateValuationChecks,
  type PrivateValuationRequest } from "../../src/lib/fundamentals/private-valuation-pubsub";

type Data = Record<string, unknown>;
const request = (companyId = "ORG:OPENAI"): PrivateValuationRequest => ({ version: 1,
  type: "private-valuation.check.requested", batchId: "request-1", companyId, requestedAt: "2026-09-29T00:00:00Z" });
const company = { name: "OpenAI", status: "DIRECTORY", listingStatus: "PRIVATE", inGraph: { status: "PUBLISHED" }, privateValuation: { value: 123 } };
function fixture() {
  const rows = new Map<string, Data>([["companies/ORG:OPENAI", structuredClone(company)]]);
  const ref = (path: string) => ({ path, firestore: db,
    get: async () => ({ id: path.split("/").at(-1), data: () => rows.get(path), get: (key: string) => rows.get(path)?.[key] }),
    create: async (data: Data) => { assert.ok(!rows.has(path)); rows.set(path, data); },
  });
  type Ref = ReturnType<typeof ref>;
  let failCommit = false;
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`),
    where: (field: string, _op: string, value: string) => ({ get: async () => ({ docs: [...rows]
      .filter(([path, data]) => path.startsWith(`${name}/`) && field.split(".").reduce<unknown>((v, k) => (v as Data)?.[k], data) === value)
      .map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })) }) }),
  }), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes: (() => void)[] = [];
    let savingCheck = false;
    const result = await fn({ get: (r: Ref) => r.get(),
      create: (r: Ref, data: Data) => writes.push(() => { assert.ok(!rows.has(r.path)); rows.set(r.path, data); }),
      set: (r: Ref, data: Data) => writes.push(() => rows.set(r.path, { ...rows.get(r.path), ...data })),
      update: (r: Ref, data: Data) => { savingCheck = true; writes.push(() => rows.set(r.path, { ...rows.get(r.path), ...data })); },
    });
    if (savingCheck && failCommit) throw Error("commit unavailable");
    writes.forEach(write => write());
    return result;
  } } as unknown as Firestore;
  const calls: string[] = [];
  const check = async (id: string) => { calls.push(id); return { status: "verified" as const, checkedAt: "2026-09-29T00:00:00Z", candidates: [] }; };
  const log = { runId: "attempt-1", emit: () => {} } as unknown as MaintenanceLog;
  return { rows, db, log, calls, check, failCommit: (value: boolean) => { failCommit = value; } };
}

test("private check validation rejects unsafe IDs and malformed messages", () => {
  for (const companyId of ["../_worker", "", "ORG:X/Y", "_worker"]) assert.throws(() => parsePrivateValuationRequest(request(companyId)));
  for (const patch of [{ version: 2 }, { batchId: "../bad" }, { requestedAt: "bad" }, { type: "fundamentals.refresh.requested" }]) {
    assert.throws(() => parsePrivateValuationRequest({ ...request(), ...patch }));
  }
  assert.deepEqual(parsePrivateValuationRequest(request()), request());
});

test("redelivery skips a completed source check and preserves reviewed valuation", async () => {
  const f = fixture();
  await processPrivateValuationCheck(request(), f.db, f.log, f.check);
  assert.equal((await processPrivateValuationCheck(request(), f.db, f.log, f.check)).completed, 1);
  assert.deepEqual(f.calls, ["ORG:OPENAI"]);
  assert.deepEqual(f.rows.get("companies/ORG:OPENAI")?.privateValuation, company.privateValuation);
  await assert.rejects(processPrivateValuationCheck(request("ORG:ANTHROPIC"), f.db, f.log, f.check), /different contents/);
});

test("provider failure remains retryable without overwriting the prior check", async () => {
  const f = fixture();
  f.rows.get("companies/ORG:OPENAI")!.privateValuationCheck = { status: "stale" };
  await assert.rejects(processPrivateValuationCheck(request(), f.db, f.log, async () => { throw Error("source offline"); }), /source offline/);
  assert.deepEqual(f.rows.get("companies/ORG:OPENAI")?.privateValuationCheck, { status: "stale" });
  assert.ok(!f.rows.get("company_fundamentals/_private_check_request-1")?.completed);
  await processPrivateValuationCheck(request(), f.db, f.log, f.check);
  assert.equal(f.calls.length, 1);
});

test("company write and completion checkpoint commit atomically", async () => {
  const f = fixture(); f.failCommit(true);
  await assert.rejects(processPrivateValuationCheck(request(), f.db, f.log, f.check), /commit unavailable/);
  assert.equal(f.rows.get("companies/ORG:OPENAI")?.privateValuationCheck, undefined);
  assert.ok(!f.rows.get("company_fundamentals/_private_check_request-1")?.completed);
  f.failCommit(false);
  await processPrivateValuationCheck(request(), f.db, f.log, f.check);
  assert.ok(f.rows.get("company_fundamentals/_private_check_request-1")?.completed);
});

test("removed or newly public companies are skipped, including changes during fetch", async () => {
  const f = fixture();
  await processPrivateValuationCheck(request(), f.db, f.log, async id => {
    f.rows.get(`companies/${id}`)!.listingStatus = "PUBLIC";
    return f.check(id);
  });
  assert.equal(f.rows.get("companies/ORG:OPENAI")?.privateValuationCheck, undefined);
  const result = await processPrivateValuationCheck({ ...request("ORG:MISSING"), batchId: "missing" }, f.db, f.log, f.check);
  assert.ok("skipped" in result && result.skipped);
  assert.equal(f.calls.length, 1);
});

test("direct worker lease prevents concurrent subscriber checks", async () => {
  const f = fixture();
  f.rows.set("company_fundamentals/_private_valuation_worker", { leaseExpiresAtMs: Date.now() + 60000 });
  await assert.rejects(processPrivateValuationCheck(request(), f.db, f.log, f.check), /busy/);
  assert.equal(f.calls.length, 0);
});

test("publisher deduplicates graph membership and task retries reuse durable messages", async () => {
  const f = fixture();
  f.rows.get("companies/ORG:OPENAI")!.aiGraph = { status: "PUBLISHED" };
  f.rows.set("companies/ORG:LEGACY", { name: "Legacy company", status: "DIRECTORY", listingStatus: "PRIVATE", aiGraph: { status: "PUBLISHED" } });
  f.rows.set("companies/ORG:REMOVED", { listingStatus: "PRIVATE", inGraph: { status: "DRAFT" }, aiGraph: { status: "PUBLISHED" } });
  f.rows.set("companies/NVDA", { ...company, listingStatus: "PUBLIC" });
  const messages: PrivateValuationRequest[] = [];
  let fail = true;
  const publish = async (message: PrivateValuationRequest) => {
    messages.push(message);
    if (fail) { fail = false; throw Error("ambiguous publish"); }
  };
  await assert.rejects(publishPrivateValuationChecks(f.db, "execution-1", publish, f.log), /ambiguous publish/);
  const result = await publishPrivateValuationChecks(f.db, "execution-1", publish, f.log);
  assert.equal(result.requested, 2);
  assert.deepEqual(messages[0], messages[1]);
  assert.deepEqual(messages.slice(1).map(m => m.companyId).sort(), ["ORG:LEGACY", "ORG:OPENAI"]);
});
