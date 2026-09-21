import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshCompanyFundamentals } from "../../src/lib/fundamentals/worker";
import { requestCompanyFundamentals } from "../../src/lib/fundamentals/service";

type Dependencies = NonNullable<Parameters<typeof refreshCompanyFundamentals>[1]>;
function fixture(initial: Record<string, unknown> = {}) {
  let stored = { ...initial };
  let requests = 0;
  let fail = false;
  let writes = 0;
  const ref = {
    get: async () => ({ data: () => stored, get: (key: string) => stored[key] }),
    set: async (value: Record<string, unknown>, options?: { merge: boolean }) => { writes++; stored = options?.merge ? { ...stored, ...value } : value; },
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
  return { dependencies, stored: () => stored, requests: () => requests, writes: () => writes, expire: () => { stored.refreshAfter = 0; }, fail: () => { fail = true; } };
}

test("fundamentals snapshot is cached and subsequent visits do not call SEC", async () => {
  const f = fixture();
  const first = await refreshCompanyFundamentals("AMD", f.dependencies);
  assert.equal(first?.report.end, "2025-12-31");
  assert.equal(first?.metrics.length, 6);
  assert.equal(f.requests(), 2);
  assert.ok(Number(f.stored().refreshAfter) > Date.now() + 22 * 3_600_000);
  assert.deepEqual(await refreshCompanyFundamentals("AMD", f.dependencies), first);
  assert.equal(f.requests(), 2);
});

test("expired snapshot survives provider failure with bounded retry delay", async () => {
  const f = fixture();
  const first = await refreshCompanyFundamentals("AMD", f.dependencies);
  f.expire(); f.fail();
  await assert.rejects(refreshCompanyFundamentals("AMD", f.dependencies), /Synthetic SEC outage/);
  assert.deepEqual(f.stored().value, first);
  assert.equal(f.stored().pending, true);
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

test("visitor bursts create one pending request and never fetch SEC", async () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) assert.equal(await requestCompanyFundamentals("AMD", f.dependencies.db), null);
  assert.equal(f.writes(), 1);
  assert.equal(f.requests(), 0);
  assert.equal(f.stored().pending, true);
  assert.ok(f.stored().requestedAt);
});

test("visitors return fresh and stale cache without downloading or overwriting it", async () => {
  const f = fixture();
  const first = await refreshCompanyFundamentals("AMD", f.dependencies);
  const writes = f.writes();
  assert.deepEqual(await requestCompanyFundamentals("AMD", f.dependencies.db), {...first, stale: false});
  assert.equal(f.writes(), writes);
  f.expire();
  await requestCompanyFundamentals("AMD", f.dependencies.db);
  assert.equal(f.stored().pending, true);
  assert.deepEqual(f.stored().value, first);
  assert.equal(f.requests(), 2);
  await refreshCompanyFundamentals("AMD", f.dependencies);
  assert.equal(f.stored().pending, false);
  assert.ok(f.stored().requestedAt);
});

test("unavailable SEC coverage retains its request history and retries after the cooldown", async () => {
  const f = fixture();
  await requestCompanyFundamentals("UNKNOWN", f.dependencies.db);
  f.dependencies.identify = async () => null;
  await refreshCompanyFundamentals("UNKNOWN", f.dependencies);
  assert.ok(f.stored().requestedAt);
  assert.equal(f.stored().outcome, "unavailable");
  const writes = f.writes();
  await requestCompanyFundamentals("UNKNOWN", f.dependencies.db);
  assert.equal(f.writes(), writes);
  f.expire();
  await requestCompanyFundamentals("UNKNOWN", f.dependencies.db);
  assert.equal(f.stored().pending, true);
});

test("invalid company IDs cannot create queue documents", async () => {
  const f = fixture();
  for (const ticker of ["", "_worker", "XSHG:688041", "AMD/other"]) {
    assert.equal(await requestCompanyFundamentals(ticker, f.dependencies.db), null);
  }
  assert.equal(f.writes(), 0);
});

for (const code of [403, 429]) test(`filing HTML ${code} preserves the queue instead of marking a company ready`, async () => {
  const f = fixture();
  const readJson = f.dependencies.readJson!;
  f.dependencies.readJson = async <T>(url: string): Promise<T> => {
    const value = await readJson<T>(url);
    if (url.includes("submissions")) (value as {filings:{recent:{form:string[]}}}).filings.recent.form = ["10-K"];
    return value;
  };
  f.dependencies.readSections = async () => { throw Object.assign(new Error("SEC filing blocked"), {code}); };
  await requestCompanyFundamentals("AMD", f.dependencies.db);
  await assert.rejects(refreshCompanyFundamentals("AMD", f.dependencies), /SEC filing blocked/);
  assert.equal(f.stored().pending, true);
  assert.equal(f.stored().outcome, "retry");
  assert.equal((f.stored().lastError as {code:number}).code, code);
});
