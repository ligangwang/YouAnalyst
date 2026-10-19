import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { CompareProfileNotReadyError, saveCompareAppearance } from "../../src/lib/compare-preferences-service";
import { DEFAULT_COMPARE_APPEARANCE } from "../../src/lib/compare-appearance";

test("preference saves never create partial profiles before bootstrap", async () => {
  let writes = 0;
  const ref = {};
  const db = { collection: () => ({ doc: () => ref }), runTransaction: async (fn: (tx: unknown) => Promise<void>) => fn({ get: async () => ({ exists: false }), set: () => { writes++; }, update: () => { writes++; } }) } as unknown as Firestore;
  await assert.rejects(saveCompareAppearance(db, "new-user", DEFAULT_COMPARE_APPEARANCE), CompareProfileNotReadyError);
  assert.equal(writes, 0);
});
test("preference saves replace overrides without changing bootstrapped profile fields", async () => {
  const profile = { nickname: "Analyst", settings: { isPublic: false }, stats: { total: 5 }, compareAppearance: { ...DEFAULT_COMPARE_APPEARANCE, companyColors: { AAPL: "#123456" } } };
  const ref = {};
  const db = { collection: () => ({ doc: () => ref }), runTransaction: async (fn: (tx: unknown) => Promise<void>) => fn({ get: async () => ({ exists: true }), update: (_ref: unknown, value: object) => Object.assign(profile, value) }) } as unknown as Firestore;
  await saveCompareAppearance(db, "existing-user", DEFAULT_COMPARE_APPEARANCE);
  assert.deepEqual(profile.settings, { isPublic: false });assert.deepEqual(profile.stats, { total: 5 });assert.equal(profile.nickname, "Analyst");
  assert.deepEqual(profile.compareAppearance.companyColors, {});
});
