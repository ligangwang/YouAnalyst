import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Firestore } from "firebase-admin/firestore";
import { canonical, mergeEdge, processBatch, validateBatch, type ComputeBatch } from "../scripts/publish-compute-research";
const fixture = (): ComputeBatch => ({ batchId: "compute-test", asOf: "2026-09-15", sources: [{ id: "s1", title: "Official release", url: "https://www.amd.com/test", sourceDate: "2025-01-01", retrievedAt: "2026-09-15" }], relationships: [{ source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF", facts: [{ state: "ANNOUNCED", scope: "Planned co-development", sourceIds: ["s1"], limitation: "Delivery unverified" }] }] });
test("symmetric/inverse descriptions share identity, different types do not", () => {
  assert.equal(canonical("US:AMD", "US:NVDA", "PARTNER_OF").id, canonical("US:NVDA", "US:AMD", "PARTNER_OF").id);
  assert.equal(canonical("US:AMD", "US:TSM", "CUSTOMER_OF").id, canonical("US:TSM", "US:AMD", "SUPPLIER_OF").id);
  assert.notEqual(canonical("US:AMD", "US:NVDA", "PARTNER_OF").id, canonical("US:AMD", "US:NVDA", "ECOSYSTEM_PARTNER_OF").id);
});
test("rejects duplicates, competition, missing evidence and delivery on planned adoption", () => {
  const b = fixture(); b.relationships.push({ ...b.relationships[0], source: "US:NVDA", target: "US:AMD" });
  assert.throws(() => validateBatch(b), /Duplicate/);
  for (const type of ["COMPETES_WITH", "UNKNOWN"]) { const b = fixture(); b.relationships[0].type = type; assert.throws(() => validateBatch(b)); }
  const missing = fixture(); missing.sources = []; assert.throws(() => validateBatch(missing), /evidence/);
  const planned = fixture(); planned.relationships[0].type = "PLANNED_ADOPTER_OF"; planned.relationships[0].facts[0].state = "DOCUMENTED"; assert.throws(() => validateBatch(planned));
});
test("repeat publication preserves evidence IDs, summary, history and deployment distinctions", () => {
  const b = fixture(), edge = b.relationships[0];
  const old = { status: "PUBLISHED", summary: "Existing deployment.", commercialStatus: "DOCUMENTED", evidence: [{ ...b.sources[0], id: "original" }], editorialNote: "retain" };
  const first = mergeEdge(b, edge, old);
  assert.equal(first.evidence?.length, 1);
  assert.equal(first.researchFacts?.[0].sourceIds[0], "original");
  assert.match(String(first.summary), /Existing deployment.*Announced\/planned/);
  assert.equal(first.commercialStatus, "DOCUMENTED"); assert.equal(first.editorialNote, "retain");
  assert.deepEqual(mergeEdge(b, edge, first), first);
  assert.deepEqual(old.summary, "Existing deployment.");
  assert.throws(() => mergeEdge(b, edge, { ...old, status: "WITHDRAWN" }));
});
test("fact identity ignores batch alias and retrieval date but retains new product facts", () => {
  const b = fixture(), first = mergeEdge(b, b.relationships[0], null);
  b.sources[0].id = "renamed"; b.relationships[0].facts[0].sourceIds = ["renamed"];
  assert.deepEqual(mergeEdge(b, b.relationships[0], first), first);
  b.relationships[0].facts.push({ ...b.relationships[0].facts[0], scope: "Existing CPU deployment", state: "DOCUMENTED" });
  const next = mergeEdge(b, b.relationships[0], first);
  assert.equal(next.researchFacts?.length, 2); assert.equal(next.evidence?.length, 1);
});
function mockDb(rows: { id: string; value: Record<string, unknown> }[], companyStatus = "DIRECTORY") {
  const writes: unknown[] = [];
  const db = { collection: (name: string) => ({ name, doc: (id: string) => ({ id, name }) }), runTransaction: async (fn: (tx: unknown) => unknown) => fn({
    get: async () => ({ docs: rows.map(r => ({ id: r.id, data: () => r.value })) }),
    getAll: async (...refs: { id: string }[]) => refs.map(r => ({ ...r, exists: true, data: () => ({ status: companyStatus }) })),
    set: (...args: unknown[]) => writes.push(args),
  }) };
  return { db: db as unknown as Firestore, writes };
}
test("preview never writes; legacy reverse key is reused and stale plans fail before writes", async () => {
  const b = fixture(); const row = { id: "legacy", value: { source: "US:NVDA", target: "US:AMD", type: "PARTNER_OF", status: "PUBLISHED", evidence: [] } };
  const m = mockDb([row]); const plan = await processBatch(m.db, b);
  assert.equal(plan.changes[0].id, "legacy"); assert.equal(m.writes.length, 0);
  await processBatch(m.db, b, plan); assert.equal(m.writes.length, 1);
  row.value.status = "WITHDRAWN"; await assert.rejects(processBatch(m.db, b, plan)); assert.equal(m.writes.length, 1);
  const clean = mockDb([]); const preview = await processBatch(clean.db, b);
  preview.changes[0].beforeHash = "stale"; await assert.rejects(processBatch(clean.db, b, preview), /stale/); assert.equal(clean.writes.length, 0);
});
test("duplicate database records and nonpublic companies fail without writes", async () => {
  const row = { id: "one", value: { source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF" } };
  const dup = mockDb([row, { ...row, id: "two" }]); await assert.rejects(processBatch(dup.db, fixture()), /duplicate/);
  const hidden = mockDb([], "WITHDRAWN"); await assert.rejects(processBatch(hidden.db, fixture()), /non-public/);
  assert.equal(dup.writes.length + hidden.writes.length, 0);
});
test("reviewed batch includes no competition and each edge is idempotent", async () => {
  const b = JSON.parse(await readFile(new URL("../data/ai-supply-chain/compute-research.json", import.meta.url), "utf8")) as ComputeBatch;
  validateBatch(b); assert.equal(b.relationships.length, 29);
  for (const e of b.relationships) { const row = mergeEdge(b, e, null); assert.deepEqual(mergeEdge(b, e, row), row); }
});
