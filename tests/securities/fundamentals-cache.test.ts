import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshCompanyFundamentals } from "../../src/lib/fundamentals/service";

type Dependencies = NonNullable<Parameters<typeof refreshCompanyFundamentals>[1]>;
function fixture(initial: Record<string, unknown> = {}) {
  let stored = { ...initial };
  let requests = 0;
  let fail = false;
  const ref = {
    get: async () => ({ data: () => stored }),
    set: async (value: Record<string, unknown>, options?: { merge: boolean }) => { stored = options?.merge ? { ...stored, ...value } : value; },
  };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ get: ref.get, set: (_ref: unknown, value: Record<string, unknown>) => ref.set(value, { merge: true }) }),
  } as unknown as Dependencies["db"];
  const dependencies: Dependencies = {
    db, identify: async () => "0000002488",
    readJson: async <T>(url: string): Promise<T> => {
      requests++;
      if (fail) throw new Error("Synthetic SEC outage");
      return (url.includes("submissions") ? { filings: { recent: {
        form: ["20-F"], accessionNumber: ["0000002488-26-000010"], filingDate: ["2026-02-01"], reportDate: ["2025-12-31"], primaryDocument: ["annual.htm"],
      } } } : { cik: 2488, facts: {} }) as T;
    },
  };
  return { dependencies, stored: () => stored, requests: () => requests, expire: () => { stored.refreshAfter = 0; }, fail: () => { fail = true; } };
}

test("fundamentals snapshot is cached and subsequent visits do not call SEC", async () => {
  const f = fixture();
  const first = await refreshCompanyFundamentals("AMD", f.dependencies);
  assert.equal(first?.report.end, "2025-12-31");
  assert.equal(first?.metrics.length, 6);
  assert.equal(f.requests(), 2);
  assert.ok(Number(f.stored().refreshAfter) > Date.now() + 23 * 3_600_000);
  assert.deepEqual(await refreshCompanyFundamentals("AMD", f.dependencies), first);
  assert.equal(f.requests(), 2);
});

test("expired snapshot survives provider failure with bounded retry delay", async () => {
  const f = fixture();
  const first = await refreshCompanyFundamentals("AMD", f.dependencies);
  f.expire(); f.fail();
  assert.deepEqual(await refreshCompanyFundamentals("AMD", f.dependencies), first);
  const retry = Number(f.stored().refreshAfter) - Date.now();
  assert.ok(retry > 3_500_000 && retry <= 3_600_000);
});

test("another active refresh lease avoids duplicate requests, including an empty first load", async () => {
  const f = fixture({ version: 1, refreshAfter: Date.now() + 60_000 });
  assert.equal(await refreshCompanyFundamentals("AMD", f.dependencies), null);
  assert.equal(f.requests(), 0);
});

test("unmapped ticker caches an unavailable result without calling Company Facts", async () => {
  const f = fixture();
  f.dependencies.identify = async () => null;
  assert.equal(await refreshCompanyFundamentals("UNKNOWN", f.dependencies), null);
  assert.equal(f.requests(), 0);
  assert.equal(f.stored().value, null);
});
