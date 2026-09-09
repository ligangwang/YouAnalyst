import assert from "node:assert/strict";
import { test } from "node:test";
import { completeHoldingsBaseline, hasVerifiedHoldingComparison } from "../../src/lib/securities/thirteen-f-comparison";
import { buildHoldingChanges, type InstitutionalHolding, type Latest13FFiling } from "../../src/lib/securities/thirteen-f";
import { latestInstitutionalMoves } from "../../src/lib/daily-scores/service";
import type { Firestore } from "firebase-admin/firestore";

const previous = { managerCik: "0000000001", quarter: "2026Q1", positionKey: "fixture", accessionNumber: "prior",
  shares: 10, valueUsd: 100, ticker: "TEST", nameOfIssuer: "Test", managerName: "Manager", cusip: "fixture" } as InstitutionalHolding;
const canonical = { managerCik: previous.managerCik, quarter: previous.quarter, accessionNumber: "prior",
  holdingsComplete: true, holdingCount: 1, form: "13F-HR" };
const filing = { managerCik: previous.managerCik, managerName: "Manager", form: "13F-HR", accessionNumber: "current",
  filingDate: "2026-08-15", reportDate: "2026-06-30" } as Latest13FFiling;
const current = { ...previous, shares: 20, valueUsd: 200, quarter: "2026Q2", accessionNumber: "current",
  filingDate: filing.filingDate, reportDate: filing.reportDate };

test("only complete, matching prior reports become baselines", () => {
  assert.equal(completeHoldingsBaseline(canonical, [previous], previous.managerCik, previous.quarter), true);
  for (const bad of [undefined, { ...canonical, holdingsComplete: false }, { ...canonical, holdingsComplete: undefined },
    { ...canonical, holdingCount: 2 }, { ...canonical, accessionNumber: "other" },
    { ...canonical, form: "13F-HR/A", amendmentType: "NEW HOLDINGS" }]) {
    assert.equal(completeHoldingsBaseline(bad, [previous], previous.managerCik, previous.quarter), false);
  }
  assert.equal(completeHoldingsBaseline({ ...canonical, holdingCount: 2 }, [previous, previous], previous.managerCik, previous.quarter), false);
  assert.equal(completeHoldingsBaseline({ ...canonical, form: "13F-HR/A", amendmentType: "RESTATEMENT" }, [previous], previous.managerCik, previous.quarter), true);
  assert.equal(completeHoldingsBaseline({ ...canonical, holdingCount: 0 }, [], previous.managerCik, previous.quarter), true);
});

test("missing baseline produces no fabricated changes; verified empty baseline can produce NEW", () => {
  assert.deepEqual(buildHoldingChanges([current], null, filing, "2026Q2", "now"), []);
  const changes = buildHoldingChanges([current], new Map(), filing, "2026Q2", "now");
  assert.equal(changes[0].status, "NEW");
  assert.equal(changes[0].baselineVerified, true);
});

test("complete baselines support increases and sold-out positions; additive amendments do not", () => {
  const prior = new Map([[previous.positionKey, previous]]);
  const changed = buildHoldingChanges([current], prior, filing, "2026Q2", "now");
  assert.equal(changed[0].status, "INCREASED");
  assert.equal(changed[0].shareChange, 10);
  assert.equal(buildHoldingChanges([], prior, filing, "2026Q2", "now")[0].status, "SOLD_OUT");
  assert.deepEqual(buildHoldingChanges([], prior, { ...filing, form: "13F-HR/A", amendmentType: "NEW HOLDINGS" }, "2026Q2", "now"), []);
  assert.equal(hasVerifiedHoldingComparison({}), false);
});

test("legacy comparisons cannot enter daily institutional rankings", async () => {
  const legacy = { ...buildHoldingChanges([current], new Map(), filing, "2026Q2", "now")[0], baselineVerified: undefined };
  const db = { collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [{ data: () => legacy }] }) }) }) }) } as unknown as Firestore;
  assert.deepEqual(await latestInstitutionalMoves(db), { increases: [], decreases: [] });
});
