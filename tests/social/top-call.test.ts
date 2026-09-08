import assert from "node:assert/strict";
import test from "node:test";
import { easternDate, eodReady, validDate, topCallFacts, validateWriting, renderPost, postLength, type TopCallFacts } from "../../src/lib/social/top-call-writing";

const facts: TopCallFacts = { date: "2026-09-08", predictionId: "call-123", ticker: "AMD", analyst: "Neo",
  direction: "DOWN", callDate: "2026-09-01", dailyReturn: 3.2, sinceEntry: -1.5, status: "LIVE", thesis: null };
const run = { status: "COMPLETED", runDate: facts.date, latestTradingDate: facts.date,
  hasMoreCandidatePredictions: false, missingPrices: 0, priceFailures: 0, marksUpdated: true, completedAt: "now" };

test("Eastern date follows daylight saving and rejects impossible dates", () => {
  assert.equal(easternDate(new Date("2026-09-09T00:30:00Z")), "2026-09-08");
  assert.equal(easternDate(new Date("2026-01-09T04:30:00Z")), "2026-01-08");
  assert.equal(validDate("2026-02-30"), false);
});
test("rejects incomplete, stale, legacy and price-only EOD runs", () => {
  assert.equal(eodReady(run, facts.date), true);
  for (const patch of [{ status: "STARTED" }, { latestTradingDate: "2026-09-07" },
    { hasMoreCandidatePredictions: true }, { missingPrices: 1 }, { priceFailures: 1 }, { marksUpdated: false }]) {
    assert.equal(eodReady({ ...run, ...patch }, facts.date), false);
  }
  assert.equal(eodReady({ status: "COMPLETED" }, facts.date), false);
});
test("rejects repeated openings and invented figures, links, hype and engagement bait", () => {
  for (const opening of ["A guaranteed winner", "Up 25% today", "What do you think?", "Visit https://evil.example"]) {
    assert.throws(() => validateWriting({ opening, layout: "analyst_first" }, []));
  }
  assert.throws(() => validateWriting({ opening: "A bearish call leads today.", layout: "result_first" },
    [{ text: "old", opening: "A bearish call leads this session." }]));
});
test("renders direction-adjusted and since-entry returns without changing signs or claiming profit", () => {
  const text = renderPost(facts, { opening: "A bearish call leads the recap.", layout: "result_first" });
  assert.match(text, /Call return: \+3.20% today; -1.50% since entry/);
  assert.match(text, /\$AMD DOWN by Neo \(called 2026-09-01; live\)/);
  assert.match(text, /https:\/\/youanalyst.com\/predictions\/call-123/);
  assert.ok(postLength(text) <= 280);
  assert.throws(() => renderPost({ ...facts, predictionId: "x".repeat(300) }, { opening: "Recap.", layout: "analyst_first" }));
});
test("missing return, attribution or direction never becomes a publishable fact", () => {
  const call = { predictionId: "id", userId: "user", ticker: "AMD", nickname: "Neo", displayName: null,
    direction: "UP" as const, dailyScoreChange: 1, totalScore: 1, dailyReturnChange: null,
    returnSinceEntry: 2, status: "LIVE" as const, createdAt: "2026-09-01T15:00:00Z", thesisTitle: null, thesis: null };
  assert.throws(() => topCallFacts(facts.date, call));
  assert.throws(() => topCallFacts(facts.date, { ...call, dailyReturnChange: 1, nickname: "@someone" }));
});
