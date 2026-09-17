import { canonicalPredictionStatus, type Prediction } from "./types";

type LegacyGroup = { id: string; userId: string; name: string; isPublic: boolean; archivedAt?: string | null };
type LegacyPrediction = Pick<Prediction, "userId" | "ticker" | "status" | "watchlistId" | "visibility"> & { id: string };

/** A read-only plan. No prediction prices, dates, visibility, or IDs are rewritten. */
export function planPublishingMigration(
  groups: LegacyGroup[],
  predictions: LegacyPrediction[],
  comparisonId: string,
  primaryPredictionIds: string[] = [],
) {
  const comparison = groups.find(group => group.id === comparisonId);
  if (!comparison || comparison.archivedAt) throw new Error("Select the existing active comparison by ID.");
  const members = predictions.filter(prediction => prediction.watchlistId === comparisonId);
  if (members.length !== 2 || members.some(member => member.userId !== comparison.userId)
    || new Set(members.map(member => member.ticker)).size !== 2
    || !members.every(member => ["AMD", "NVDA"].includes(member.ticker))) {
    throw new Error("The confirmed comparison must contain exactly the owner's AMD and NVDA predictions.");
  }

  const active = new Map<string, string[]>();
  const issues: Array<{ predictionId: string; reason: string }> = [];
  const groupById = new Map(groups.map(group => [group.id, group]));
  for (const prediction of predictions) {
    const group = groupById.get(prediction.watchlistId);
    const status = canonicalPredictionStatus(prediction.status);
    if ((!group && status !== "CANCELED" && status !== "SETTLED") || (group && group.userId !== prediction.userId)) {
      issues.push({ predictionId: prediction.id, reason: "Missing group or ownership mismatch" });
    } else if (group && !group.isPublic && prediction.visibility === "PUBLIC") {
      issues.push({ predictionId: prediction.id, reason: "Public prediction in a private group requires privacy review" });
    }
    if (status === "CREATED" || status === "OPEN" || status === "CLOSING") {
      const key = JSON.stringify([prediction.userId, prediction.ticker]);
      active.set(key, [...(active.get(key) ?? []), prediction.id]);
    }
  }
  const conflicts = [...active.entries()].filter(([, ids]) => ids.length > 1)
    .map(([key, predictionIds]) => {
      const [userId, ticker] = JSON.parse(key) as [string, string];
      return { userId, ticker, predictionIds: predictionIds.sort() };
    });
  const primarySelections = conflicts.flatMap(conflict => {
    const selected = conflict.predictionIds.filter(id => primaryPredictionIds.includes(id));
    if (selected.length > 1) throw new Error("Select exactly one primary prediction for each legacy conflict");
    return selected.length ? [{ userId: conflict.userId, ticker: conflict.ticker, predictionId: selected[0] }] : [];
  });
  return {
    ready: conflicts.length === primarySelections.length && issues.length === 0,
    groupsReady: issues.length === 0,
    primarySelections,
    comparison: {
      id: comparison.id, userId: comparison.userId, name: comparison.name,
      isPublic: comparison.isPublic, predictionIds: members.map(member => member.id).sort(),
    },
    archiveGroupIds: groups.filter(group => group.id !== comparisonId && !group.archivedAt).map(group => group.id).sort(),
    preservedPredictionCount: predictions.length,
    conflicts,
    issues,
  };
}
