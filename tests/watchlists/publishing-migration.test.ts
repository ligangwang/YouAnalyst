import assert from "node:assert/strict";
import test from "node:test";
import { planPublishingMigration } from "../../src/lib/predictions/publishing-migration";

const groups = [
  { id: "comparison", userId: "owner", name: "NVDA vs AMD", isPublic: true },
  { id: "general", userId: "owner", name: "AI Chip & Apps", isPublic: true },
];
const predictions = [
  { id: "amd", userId: "owner", ticker: "AMD", status: "OPEN" as const, watchlistId: "comparison", visibility: "PUBLIC" as const },
  { id: "nvda", userId: "owner", ticker: "NVDA", status: "OPEN" as const, watchlistId: "comparison", visibility: "PUBLIC" as const },
];

test("only the explicitly selected comparison survives; original records are untouched", () => {
  const before = JSON.stringify({ groups, predictions });
  const plan = planPublishingMigration(groups, predictions, "comparison");
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.archiveGroupIds, ["general"]);
  assert.deepEqual(plan.comparison.predictionIds, ["amd", "nvda"]);
  assert.equal(JSON.stringify({ groups, predictions }), before);
});

test("duplicate active calls block migration instead of merging history", () => {
  const plan = planPublishingMigration(groups, [...predictions, { ...predictions[0], id: "other-amd", watchlistId: "general" }], "comparison");
  assert.equal(plan.ready, false);
  assert.equal(plan.groupsReady, true);
  assert.deepEqual(plan.conflicts[0].predictionIds, ["amd", "other-amd"]);
  assert.equal(plan.preservedPredictionCount, 3);
});

test("explicit primary selection resolves duplicate article routing without removing comparison history", () => {
  const rows = [...predictions, { ...predictions[0], id: "other-amd", watchlistId: "general" }];
  const plan = planPublishingMigration(groups, rows, "comparison", ["other-amd"]);
  assert.equal(plan.ready, true);
  assert.equal(plan.primarySelections[0].predictionId, "other-amd");
  assert.deepEqual(plan.comparison.predictionIds, ["amd", "nvda"]);
  assert.equal(plan.preservedPredictionCount, 3);
});

test("settled history does not conflict with an active call", () => {
  const plan = planPublishingMigration(groups, [...predictions, { ...predictions[0], id: "old-amd", status: "SETTLED", watchlistId: "general" }], "comparison");
  assert.equal(plan.ready, true);
});

test("comparison membership must match ownership and the confirmed two symbols", () => {
  assert.throws(() => planPublishingMigration(groups, [{ ...predictions[0], userId: "other" }, predictions[1]], "comparison"));
  assert.throws(() => planPublishingMigration(groups, predictions, "general"));
  assert.throws(() => planPublishingMigration(groups, predictions, "unknown"));
});

test("privacy discrepancies block migration, private comparisons stay private", () => {
  const privateGroups = groups.map(group => ({ ...group, isPublic: false }));
  assert.equal(planPublishingMigration(privateGroups, predictions, "comparison").ready, false);
  const plan = planPublishingMigration(privateGroups, predictions.map(p => ({ ...p, visibility: "PRIVATE" })), "comparison");
  assert.equal(plan.ready, true);
  assert.equal(plan.comparison.isPublic, false);
});
