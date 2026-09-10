import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAbsoluteDateTime, formatRelativeDateTime } from "../../src/lib/time";

test("compact times use the same boundaries and distinguish minutes from months", () => {
  const start = "2026-01-10T12:00:00.000Z";
  const base = Date.parse(start);
  for (const [seconds, label] of [[-60, "now"], [0, "now"], [59, "now"], [60, "1m"], [3599, "59m"], [3600, "1h"], [86400, "1d"]] as const) {
    assert.equal(formatRelativeDateTime(start, base + seconds * 1000), label);
  }
  assert.equal(formatRelativeDateTime(start, Date.parse("2026-02-10T12:00:00Z")), "1mo");
  assert.equal(formatRelativeDateTime(start, Date.parse("2027-01-10T12:00:00Z")), "1y");
  assert.equal(formatRelativeDateTime("invalid", base), "—");
  assert.equal(formatAbsoluteDateTime(start), "Jan 10, 2026, 12:00:00 PM UTC");
});
