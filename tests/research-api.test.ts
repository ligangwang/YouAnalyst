import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { TokenPayload } from "google-auth-library";
import { authorizeClaims, ResearchError } from "../src/lib/research/auth";
import { previewBatch, publishBatch, getBatch, validateInput } from "../src/lib/research/batches";
import { hash } from "../src/lib/research/publisher";
import { readResearchJson, researchRequest } from "../src/lib/research/http";
const owner = { sub: "123456789", email: "publisher@test.iam.gserviceaccount.com" };
const expected = { ...owner, audience: "https://example.com" };
function fixture() { return { batchId: "api-test", asOf: "2026-09-15", sources: [{ id: "s1", title: "Official release", url: "https://www.amd.com/release", sourceDate: "2025-01-01", retrievedAt: "2026-09-15" }], relationships: [{ source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF", facts: [{ state: "ANNOUNCED", scope: "Joint future products", sourceIds: ["s1"], limitation: "Delivery not verified" }] }] }; }
test("requires exact publisher, audience, issuer, verified email and one-hour lifetime", () => {
  const good: TokenPayload = { iss: "https://accounts.google.com", aud: expected.audience, sub: owner.sub, email: owner.email, email_verified: true, iat: 1000, exp: 4600 };
  assert.deepEqual(authorizeClaims(good, expected, 2000), owner);
  for (const change of [{ aud: "wrong" }, { sub: "another" }, { email: "attacker@example.com" }, { email_verified: false }, { iss: "https://attacker.example" }, { exp: 1999 }, { iat: 2100 }, { exp: 9999 }]) assert.throws(() => authorizeClaims({ ...good, ...change }, expected, 2000), ResearchError);
});
test("unauthenticated/forged requests fail before data access and responses never cache", async () => {
  const prior = { ...process.env };
  process.env.RESEARCH_TOKEN_AUDIENCE = expected.audience; process.env.RESEARCH_PUBLISHER_SUB = owner.sub; process.env.RESEARCH_PUBLISHER_EMAIL = owner.email;
  try {
    for (const authorization of ["", "Bearer not.a.valid-signature"]) {
      const response = await researchRequest(new Request("https://example.com/api/admin/research/preview", { method: "POST", headers: { authorization }, body: "bad" }), "preview");
      assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
    }
    delete process.env.RESEARCH_PUBLISHER_SUB;
    assert.equal((await researchRequest(new Request("https://example.com"), "get", "test")).status, 503);
  } finally { for (const key of ["RESEARCH_TOKEN_AUDIENCE", "RESEARCH_PUBLISHER_SUB", "RESEARCH_PUBLISHER_EMAIL"]) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } }
});
test("streaming body limits and invalid input fail safely", async () => {
  await assert.rejects(readResearchJson(new Request("https://example.com", { method: "POST", body: "{}" })), { status: 415 });
  await assert.rejects(readResearchJson(new Request("https://example.com", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(180001) })), { status: 413 });
  await assert.rejects(readResearchJson(new Request("https://example.com", { method: "POST", headers: { "content-type": "application/json" }, body: "invalid" })), { status: 400 });
  for (const input of [null, [], {}, { ...fixture(), batchId: "../escape" }]) assert.throws(() => validateInput(input), ResearchError);
  const raw = { ...fixture(), status: "PUBLISHED", collection: "users" }; assert.equal("status" in validateInput(raw), false);
});
// Transaction fake buffers writes and mimics Firestore map-key reordering on storage.
function fakeDb() {
  const data = new Map<string, unknown>(); let writes = 0;
  const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => b.localeCompare(a)).map(([k, v]) => [k, reorder(v)])) : v;
  const snap = (ref: { path: string; id: string }) => ({ id: ref.id, exists: data.has(ref.path), data: () => data.get(ref.path) });
  const db = { collection: (name: string) => ({ name, doc: (id: string) => { const ref = { path: `${name}/${id}`, id }; return { ...ref, get: async () => snap(ref) }; } }), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const pending: [string, unknown][] = [];
    const result = await fn({ get: async (ref: { path?: string; id: string; name?: string }) => ref.path ? snap(ref as { path: string; id: string }) : { docs: [...data].filter(([k]) => k.startsWith(`${ref.name}/`)).map(([k]) => snap({ path: k, id: k.split("/")[1] })) }, getAll: async (...refs: { path: string; id: string }[]) => refs.map(snap), set: (ref: { path: string }, v: unknown) => pending.push([ref.path, v]) });
    for (const [k, v] of pending) { data.set(k, reorder(v)); writes++; } return result;
  } };
  data.set("companies/US:AMD", { status: "DIRECTORY" }); data.set("companies/US:NVDA", { status: "PUBLISHED" });
  return { db: db as unknown as Firestore, data, writes: () => writes };
}
test("preview then publication retains before-images and retries make no writes", async () => {
  const m = fakeDb(), b = fixture();
  const preview = await previewBatch(m.db, b, owner);
  assert.equal(preview.status, "PREVIEW"); assert.equal(preview.result.additions, 1); assert.equal(m.data.size, 3);
  const repeat = await previewBatch(m.db, b, owner); assert.equal(repeat.previewToken, preview.previewToken); assert.equal(m.writes(), 1);
  const published = await publishBatch(m.db, preview.id, preview.previewToken, owner);
  assert.equal(published.status, "PUBLISHED"); assert.equal(m.writes(), 3);
  await publishBatch(m.db, preview.id, preview.previewToken, owner); assert.equal(m.writes(), 3);
  const query = await getBatch(m.db, b.batchId, owner); assert.equal(query.audit.changes[0].before, null);
  assert.equal(query.audit.changes[0].after.publishedAt, (m.data.get(`company_relationships/${query.changes[0].id}`) as { publishedAt: string }).publishedAt);
});
test("rejects foreign owners, changed batch content, wrong versions, expired and stale previews atomically", async () => {
  const m = fakeDb(), b = fixture(); const p = await previewBatch(m.db, b, owner);
  await assert.rejects(previewBatch(m.db, { ...b, asOf: "2026-09-14" }, owner));
  await assert.rejects(getBatch(m.db, b.batchId, { ...owner, sub: "other" }), { status: 403 });
  await assert.rejects(publishBatch(m.db, b.batchId, "wrong", owner), { status: 409 });
  const key = "company_relationships/US:AMD__PARTNER_OF__US:NVDA";
  m.data.set(key, { source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF", status: "WITHDRAWN" });
  await assert.rejects(publishBatch(m.db, b.batchId, p.previewToken, owner)); assert.equal(m.writes(), 1);
  const record = m.data.get("research_batches/api-test") as { expiresAt: string }; record.expiresAt = "2000-01-01T00:00:00Z";
  await assert.rejects(publishBatch(m.db, b.batchId, p.previewToken, owner), { status: 409 }); assert.equal(m.writes(), 1);
});
test("hash survives Firestore key order changes", () => assert.equal(hash({ a: 1, nested: { z: 2, b: 3 } }), hash({ nested: { b: 3, z: 2 }, a: 1 })));
