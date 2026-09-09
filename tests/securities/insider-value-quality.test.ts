import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeInsiderTransactionAmounts } from "../../src/lib/securities/insider-transaction-values";
import { INSIDER_VALUE_REVIEW_HOLDS } from "../../src/lib/securities/insider-value-quality";
import { latestInsiderMoves, type DailyInsiderMove } from "../../src/lib/daily-scores/service";
import { insiderMoveFromSnapshotSegment, insiderMoveSnapshotSegment } from "../../src/lib/daily-scores/insider-share-snapshot";

const iht = {
  accessionNumber: "0001493152-26-040902", ticker: "IHT", issuerName: "INNSUITES HOSPITALITY TRUST",
  filingDate: "2026-08-31", transactionDate: "2026-08-28", transactionCode: "S",
  shares: 25_000, pricePerShare: 32_102.45, valueUsd: 802_561_250, reportingOwnerCik: "0001055365",
};

test("IHT source price is preserved but its derived total is withheld, including preexisting data", () => {
  const result = normalizeInsiderTransactionAmounts(iht);
  assert.equal(result.pricePerShare, 32_102.45);
  assert.equal(result.valueUsd, null);
  assert.equal(result.valueQuality, "needs_review");
  assert.match(result.valueQualityReason!, /source review/i);
  assert.equal(normalizeInsiderTransactionAmounts({ ...iht, accessionNumber: undefined }).valueQuality, "needs_review");
});

test("all observed review holds remain excluded even if stored values were previously normalized", () => {
  for (const hold of INSIDER_VALUE_REVIEW_HOLDS) {
    assert.equal(normalizeInsiderTransactionAmounts({ ...hold, shares: 25_000, pricePerShare: 1.284098 }).valueUsd, null);
  }
});

test("aggregate-looking price fields prompt review rather than a guessed unit-price correction", () => {
  const result = normalizeInsiderTransactionAmounts({ shares: 150_000, pricePerShare: 2_000_000 });
  assert.equal(result.pricePerShare, 2_000_000);
  assert.equal(result.valueUsd, null);
  assert.equal(result.valueQuality, "needs_review");
});

test("ordinary transactions and legitimate high-priced shares remain usable outside the review holds", () => {
  const normal = normalizeInsiderTransactionAmounts({ shares: 4_611, pricePerShare: 234, valueUsd: 999 });
  assert.equal(normal.valueUsd, 1_078_974);
  assert.equal(normal.valueQuality, "usable");
  assert.equal(normalizeInsiderTransactionAmounts({ shares: 2, pricePerShare: 700_000 }).valueUsd, 1_400_000);
  assert.equal(normalizeInsiderTransactionAmounts({ ...iht, accessionNumber: null, filingDate: "2026-09-09", pricePerShare: 1.3 }).valueQuality, "usable");
});

test("missing, nonfinite, negative, and unsafe amounts cannot fall back to an unchecked stored total", () => {
  for (const shares of [null, 0, -1, NaN, Infinity]) {
    assert.equal(normalizeInsiderTransactionAmounts({ shares, pricePerShare: 20, valueUsd: 1_000 }).valueUsd, null);
  }
  for (const pricePerShare of [null, 0, -1, NaN, Infinity]) {
    assert.equal(normalizeInsiderTransactionAmounts({ shares: 100, pricePerShare, valueUsd: 1_000 }).valueUsd, null);
  }
  assert.equal(normalizeInsiderTransactionAmounts({ shares: 1e15, pricePerShare: 20 }).valueQuality, "needs_review");
});

// Read-only fixture exercises the production aggregation, with no credentials or network.
function database(rows: Record<string, unknown>[]): Firestore {
  return { collection(name: string) {
    assert.equal(name, "insider_transactions");
    return { orderBy() { return { limit() { return { async get() {
      return { docs: rows.map((data, i) => ({ id: String(i), data: () => data })) };
    } }; } }; } };
  } } as unknown as Firestore;
}

test("rankings exclude entire affected groups before sorting, preserving unrelated totals", async () => {
  const normal = { ...iht, ticker: "GOOD", accessionNumber: "fixture-good", shares: 100, pricePerShare: 12 };
  const uncertain = { ...normal, ticker: "PARTIAL", pricePerShare: null };
  for (const rows of [
    [iht, normal, { ...normal, shares: 50 }, uncertain, { ...uncertain, pricePerShare: 10 }],
    [{ ...uncertain, pricePerShare: 10 }, uncertain, normal, { ...normal, shares: 50 }, iht],
  ]) {
    const result = await latestInsiderMoves(database(rows));
    assert.equal(result.excludedGroups, 2);
    assert.deepEqual(result.purchases, []);
    assert.equal(result.sales.length, 1);
    assert.equal(result.sales[0].ticker, "GOOD");
    assert.equal(result.sales[0].totalValueUsd, 1_800);
    assert.equal(result.sales[0].totalShares, 150);
    assert.equal(result.sales[0].transactionCount, 2);
    assert.equal(result.sales[0].insiderCount, 1);
  }
});

const legacyMove: DailyInsiderMove = {
  ticker: "IHT", issuerName: iht.issuerName, filingDate: iht.filingDate, transactionCode: "S",
  totalValueUsd: iht.valueUsd, totalShares: iht.shares, insiderCount: 1, transactionCount: 1,
  latestTransactionDate: iht.transactionDate,
};

test("legacy share snapshots cannot reintroduce a held amount in base64 or raw JSON formats", () => {
  assert.equal(insiderMoveFromSnapshotSegment(insiderMoveSnapshotSegment(legacyMove), "IHT"), null);
  const tuple = [legacyMove.issuerName, legacyMove.filingDate, "S", legacyMove.totalValueUsd,
    legacyMove.totalShares, 1, 1, legacyMove.latestTransactionDate];
  assert.equal(insiderMoveFromSnapshotSegment(JSON.stringify(tuple), "iht"), null);
  assert.equal(insiderMoveFromSnapshotSegment(encodeURIComponent(JSON.stringify(tuple)), "IHT"), null);
  const normal = { ...legacyMove, ticker: "GOOD", totalValueUsd: 25_000 };
  assert.deepEqual(insiderMoveFromSnapshotSegment(insiderMoveSnapshotSegment(normal), "GOOD"), normal);
});

test("invalid snapshot quantities are rejected", () => {
  for (const override of [{ totalValueUsd: -1 }, { totalShares: 0 }, { insiderCount: 0 }, { transactionCount: 0.5 }]) {
    const move = { ...legacyMove, ticker: "GOOD", ...override };
    assert.equal(insiderMoveFromSnapshotSegment(insiderMoveSnapshotSegment(move), "GOOD"), null);
  }
});
