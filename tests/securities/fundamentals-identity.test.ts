import { test } from "node:test";
import assert from "node:assert/strict";
import { usFundamentalsId, usFundamentalsTicker } from "../../src/lib/fundamentals/identity";

test("canonical company IDs round-trip while metadata, legacy IDs and other markets are excluded", () => {
  for (const ticker of ["NVDA", "BRK.B", "BF-B"]) assert.equal(usFundamentalsTicker(usFundamentalsId(ticker)), ticker);
  for (const id of ["NVDA", "_worker", "_batch_123", "XSHG:688041", "US:", "US:../bad"]) assert.equal(usFundamentalsTicker(id), null);
  for (const ticker of ["US:NVDA", "_worker", "../bad", ""]) assert.throws(() => usFundamentalsId(ticker));
});
