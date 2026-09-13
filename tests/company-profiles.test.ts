import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeCompanyProfile } from "../src/lib/company-profile";
import { publishProfiles, validateProfiles, type ProfileBatch } from "../scripts/publish-company-profiles";

const fixture = async () => JSON.parse(await readFile(new URL("../data/ai-supply-chain/company-profiles.json", import.meta.url), "utf8")) as ProfileBatch;
function database(batch: ProfileBatch) {
  const records = new Map(batch.companies.map(c => [c.id, { name: c.expectedName, status: "DIRECTORY", description: "Reviewed description", aiGraph: { status: "PUBLISHED" } } as Record<string, unknown>]));
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
test("reviewed profiles have valid sourced reports without future or impossible dates", async () => {
  const batch = await fixture(); validateProfiles(batch);
  const bad = structuredClone(batch);
  const c = bad.companies.find(c => c.profile.financialReport)!;
  c.profile.financialReport!.periodEnd = "2026-02-30";
  assert.throws(() => validateProfiles(bad), /invalid profile/);
  c.profile = { ...c.profile, financialReportStatus: "UNVERIFIED" };
  assert.equal(normalizeCompanyProfile({ ...c.profile, website: { url: "javascript:alert(1)", sourceUrl: "https://example.com" } })?.website, undefined);
});
test("preview is read-only and publication changes only the existing profile field", async () => {
  const batch = await fixture(), { db, records, modes } = database(batch), before = structuredClone(records);
  await publishProfiles(db, batch); assert.deepEqual(records, before); assert.deepEqual(modes, [true]);
  await publishProfiles(db, batch, true);
  assert.equal(records.size, before.size);
  for (const [id, old] of before) { const { profile, ...rest } = records.get(id)!; assert(profile); assert.deepEqual(rest, old); }
});
test("identity changes, missing companies and stale reports abort all writes", async () => {
  const batch = await fixture(), { db, records } = database(batch);
  records.get(batch.companies[0].id)!.name = "Different company";
  const before = structuredClone(records);
  await assert.rejects(publishProfiles(db, batch, true), /identity changed/); assert.deepEqual(records, before);
  records.delete(batch.companies[0].id);
  await assert.rejects(publishProfiles(db, batch, true), /missing company/);
  const other = database(batch), report = batch.companies.find(c => c.profile.financialReport)!;
  other.records.get(report.id)!.profile = { checkedAt: "2099-01-01" };
  await assert.rejects(publishProfiles(other.db, batch, true), /newer profile/);
  const corrected = database(batch), earlier = structuredClone(batch), candidate = earlier.companies.find(c => c.id === report.id)!;
  corrected.records.get(report.id)!.profile = report.profile;
  candidate.profile.financialReport!.publishedAt = candidate.profile.financialReport!.periodEnd;
  const unchanged = structuredClone(corrected.records);
  await assert.rejects(publishProfiles(corrected.db, earlier, true), /older corrected report/);
  assert.deepEqual(corrected.records, unchanged);
});
