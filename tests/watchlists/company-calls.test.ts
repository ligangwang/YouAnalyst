import { test } from "node:test";
import assert from "node:assert/strict";
import { companyCallsForViewer } from "../../src/lib/predictions/company-calls";

const data = { userId: "owner", ticker: "AMD", watchlistId: "main", watchlistName: "Old name", visibility: "PUBLIC", direction: "UP", status: "OPEN", entryPrice: 150.25, entryDate: "2026-09-08", createdAt: "2026-09-07T18:00:00Z" };
const lists = [
  { id: "other", data: { userId: "owner", name: "Hedges", createdAt: "2026-02-01" } },
  { id: "main", data: { userId: "owner", name: "My Watchlist", createdAt: "2026-01-01" } },
];

test("all active owned calls are returned, including private calls, with the default first", () => {
  const result = companyCallsForViewer("owner", "AMD", [
    { id: "hedge", data: { ...data, watchlistId: "other", direction: "DOWN", visibility: "PRIVATE" } },
    { id: "main", data },
    { id: "settled", data: { ...data, status: "SETTLED" } },
    { id: "canceled", data: { ...data, status: "CANCELED" } },
    { id: "someone-else", data: { ...data, userId: "other-user" } },
    { id: "other-stock", data: { ...data, ticker: "NVDA" } },
  ], lists);
  assert.deepEqual(result.map(call => call.id), ["main", "hedge"]);
  assert.equal(result[0].watchlistName, "My Watchlist");
  assert.equal(result[0].isDefault, true);
  assert.equal(result[1].visibility, "Private");
  assert.equal(result[1].direction, "DOWN");
});

test("legacy pending status retains the cancellation deadline and no fabricated entry", () => {
  const [call] = companyCallsForViewer("owner", "AMD", [{ id: "pending", data: { ...data, status: "OPENING", entryPrice: null, entryDate: null } }], lists);
  assert.equal(call.status, "CREATED");
  assert.equal(call.entryPrice, null);
  assert.equal(call.cancelUntil, "2026-09-07T18:05:00.000Z");
});

test("closing calls remain visible and an archived list does not become default", () => {
  const [call] = companyCallsForViewer("owner", "AMD", [{ id: "closing", data: { ...data, status: "CLOSING", entryPrice: NaN } }], lists.map(list => list.id === "main" ? { ...list, data: { ...list.data, archivedAt: "2026-09-01" } } : list));
  assert.equal(call.status, "CLOSING");
  assert.equal(call.isDefault, false);
  assert.equal(call.cancelUntil, null);
  assert.equal(call.entryPrice, null);
});
