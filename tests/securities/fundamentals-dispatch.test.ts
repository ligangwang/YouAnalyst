import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchRequestedFundamentals } from "../../src/lib/fundamentals/dispatch";
import { sharedFirestore } from "./shared-firestore-fixture";
import type { FundamentalsRequest } from "../../src/lib/fundamentals/pubsub";

test("simultaneous visitors dispatch one request per pending company", async () => {
  const f = sharedFirestore(), messages: FundamentalsRequest[] = [];
  for (const ticker of ["AMD", "NVDA"]) f.documents.set(`company_fundamentals/${ticker}`, { pending: true, requestedAt: new Date(f.now()).toISOString() });
  const publish = async (message: FundamentalsRequest) => { messages.push(message); return "message-id"; };
  await Promise.all(Array.from({ length: 30 }, (_, i) => dispatchRequestedFundamentals(i % 2 ? "AMD" : "NVDA", f.db, publish)));
  assert.equal(messages.length, 2);
  assert.notEqual(messages[0].batchId, messages[1].batchId);
  f.advance(300_000);
  await dispatchRequestedFundamentals("AMD", f.db, publish);
  assert.equal(messages[2].batchId, messages.find(message => message.companyIds[0] === "AMD")!.batchId);
});

test("fresh, unavailable, cooling down and invalid companies do not dispatch", async () => {
  const f = sharedFirestore();
  let calls = 0;
  for (const state of [{ pending: false }, { pending: true, refreshAfter: f.now() + 1000 }, {}]) {
    f.documents.set("company_fundamentals/AMD", state);
    await dispatchRequestedFundamentals("AMD", f.db, async () => { calls++; return "id"; });
  }
  await dispatchRequestedFundamentals("../bad", f.db, async () => { calls++; return "id"; });
  assert.equal(calls, 0);
});

test("failed publish retains durable work and allows a bounded retry", async t => {
  t.mock.method(console, "error", () => {});
  const f = sharedFirestore();
  f.documents.set("company_fundamentals/AMD", { pending: true });
  let calls = 0;
  const publish = async () => { calls++; throw new Error("topic unavailable"); };
  await dispatchRequestedFundamentals("AMD", f.db, publish);
  assert.equal(f.documents.get("company_fundamentals/AMD")!.pending, true);
  await dispatchRequestedFundamentals("AMD", f.db, publish);
  assert.equal(calls, 1);
  f.advance(30_000);
  await dispatchRequestedFundamentals("AMD", f.db, publish);
  assert.equal(calls, 2);
});
