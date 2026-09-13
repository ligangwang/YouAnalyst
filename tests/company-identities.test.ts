import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Firestore } from "firebase-admin/firestore";
import { publishIdentities, validateIdentities, type IdentityBatch } from "../scripts/publish-company-identities";
import { companyGeography, companyGeographyLabel } from "../src/lib/market-companies/identity";

const fixture = async () => JSON.parse(await readFile(new URL("../data/ai-supply-chain/company-identities.json", import.meta.url), "utf8")) as IdentityBatch;
function database(batch: IdentityBatch) {
  const records = new Map(batch.companies.map(c => [c.id, { name: c.expectedName, status: "DIRECTORY", listingStatus: "UNKNOWN", description: "Reviewed business", profile: { checkedAt: batch.asOf }, aiGraph: { status: "PUBLISHED" } } as Record<string, unknown>]));
  const modes: boolean[] = [];
  const db = {
    collection: (name: string) => { assert.equal(name, "companies"); return { doc: (id: string) => id }; },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>, options: { readOnly: boolean }) => {
      modes.push(options.readOnly);
      const pending: [string, Record<string, unknown>][] = [];
      const result = await fn({ getAll: async (...ids: string[]) => ids.map(id => ({ data: () => structuredClone(records.get(id)) })), update: (id: string, patch: Record<string, unknown>) => pending.push([id, patch]) });
      for (const [id, patch] of pending) records.set(id, { ...records.get(id), ...patch });
      return result;
    },
  } as unknown as Firestore;
  return { db, records, modes };
}
test("all listed map companies have sourced identity metadata independent of trading market", async () => {
  const batch = await fixture(); validateIdentities(batch);
  assert.equal(batch.companies.length, 129);
  assert.equal(batch.companies.find(c => c.id === "US:ARM")?.country, "GB");
  assert.equal(batch.companies.find(c => c.id === "US:ASML")?.country, "NL");
  for (const c of batch.companies) for (const locale of ["en", "zh-CN"]) assert.doesNotMatch(companyGeographyLabel(companyGeography(c), locale), /unverified|待核实/);
  const bad = structuredClone(batch); bad.companies[0].listings[0].symbol = "WRONG";
  assert.throws(() => validateIdentities(bad), /listing does not match/);
  const arbitrary = structuredClone(batch); arbitrary.companies[0].expectedCountry = "CN";
  assert.throws(() => validateIdentities(arbitrary), /invalid expected country/);
  const wrongMarket = structuredClone(batch); wrongMarket.companies.find(c => c.id.startsWith("XSHG:"))!.expectedCountry = "United States";
  assert.throws(() => validateIdentities(wrongMarket), /invalid expected country/);
});
test("identity preview is read-only; write preserves profiles, graph data and extra listings and is idempotent", async () => {
  const batch = await fixture(), { db, records, modes } = database(batch);
  const extra = { market: "HK", exchange: "XHKG", symbol: "9988" };
  records.get("US:BABA")!.listings = [extra];
  for (const c of batch.companies) if (c.expectedCountry) records.get(c.id)!.country = c.expectedCountry;
  const before = structuredClone(records);
  await publishIdentities(db, batch); assert.deepEqual(records, before); assert.deepEqual(modes, [true]);
  await publishIdentities(db, batch, true);
  for (const [id, old] of before) {
    const current = records.get(id)!;
    assert.equal(current.listingStatus, "PUBLIC");
    for (const key of ["name", "status", "description", "profile", "aiGraph"]) assert.deepEqual(current[key], old[key]);
  }
  assert.deepEqual((records.get("US:BABA")!.listings as unknown[])[0], extra);
  const published = structuredClone(records); await publishIdentities(db, batch, true); assert.deepEqual(records, published);
});
test("conflicting or newer identities and missing companies abort the entire batch", async () => {
  const batch = await fixture();
  for (const [patch, error] of [[{ name: "Changed" }, /identity changed/], [{ country: "ZZ" }, /country conflict/], [{ listingStatus: "PRIVATE" }, /listing status conflict/], [{ identityReviewedAt: "2099-01-01" }, /newer identity/]] as const) {
    const { db, records } = database(batch); Object.assign(records.get(batch.companies.at(-1)!.id)!, patch);
    const before = structuredClone(records); await assert.rejects(publishIdentities(db, batch, true), error); assert.deepEqual(records, before);
  }
  const { db, records } = database(batch); records.delete(batch.companies[0].id);
  await assert.rejects(publishIdentities(db, batch, true), /missing company/);
});
