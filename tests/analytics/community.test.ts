import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_RANKED_ANALYSTS, SHOW_ANALYST_LEVELS, rankingsOpen } from "../../src/lib/community";

test("analyst levels are hidden and rankings need ten ranked analysts by default", () => {
  assert.equal(SHOW_ANALYST_LEVELS, false);
  assert.equal(MIN_RANKED_ANALYSTS, 10);
  assert.equal(rankingsOpen(3), false);
  assert.equal(rankingsOpen(10), true);
  assert.equal(rankingsOpen(null), false);
  assert.equal(rankingsOpen(2, 2), true);
});
