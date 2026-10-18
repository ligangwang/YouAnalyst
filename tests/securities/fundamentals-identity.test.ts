import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { usFundamentalsId, usFundamentalsTicker } from "../../src/lib/fundamentals/identity";
import { copyLegacyFundamentals } from "../../src/lib/fundamentals/migrate-ids";

test("canonical company IDs round-trip while metadata, legacy IDs and other markets are excluded", () => {
  for (const ticker of ["NVDA", "BRK.B", "BF-B"]) assert.equal(usFundamentalsTicker(usFundamentalsId(ticker)), ticker);
  for (const id of ["NVDA", "_worker", "_batch_123", "XSHG:688041", "US:", "US:../bad"]) assert.equal(usFundamentalsTicker(id), null);
  for (const ticker of ["US:NVDA", "_worker", "../bad", ""]) assert.throws(() => usFundamentalsId(ticker));
});

test("migration previews, preserves complete Firestore values, resumes and rejects conflicts", async () => {
  const original = { value: { ticker: "NVDA" }, pending: true,
    secFilingsCollector: { baselineAt: "2026-10-17" }, stamp: Timestamp.fromMillis(1234) };
  const rows = new Map<string, unknown>([["NVDA", original]]);
  const db = {
    collection: (name: string) => { assert.equal(name, "company_fundamentals"); return { doc: (id: string) => ({ id }) }; },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async ({ id }: { id: string }) => ({ exists: rows.has(id), data: () => rows.get(id) }),
      create: ({ id }: { id: string }, value: unknown) => { assert(!rows.has(id)); rows.set(id, value); },
    }),
  } as unknown as Firestore;
  assert.equal(await copyLegacyFundamentals(db, "NVDA"), "would_copy");
  assert.equal(rows.size, 1);
  assert.equal(await copyLegacyFundamentals(db, "NVDA", true), "copied");
  assert.deepEqual(rows.get("US:NVDA"), original);
  assert.equal(rows.get("NVDA"), original);
  assert.equal(await copyLegacyFundamentals(db, "NVDA", true), "identical");
  rows.set("US:NVDA", { newer: true });
  await assert.rejects(copyLegacyFundamentals(db, "NVDA", true), /Conflicting/);
  assert.deepEqual(rows.get("US:NVDA"), { newer: true });
  assert.equal(await copyLegacyFundamentals(db, "MISSING", true), "missing");
});
