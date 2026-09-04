import { FieldValue } from "firebase-admin/firestore";
import {
  computeLevel,
  computePredictionOutcome,
  computePredictionScore,
  computePredictionXp,
  computeSettledPredictionAnalytics,
  computeUserAnalytics,
  type PredictionAnalytics,
  type UserAnalytics,
} from "@/lib/predictions/analytics";
import { isPredictionDirection } from "@/lib/predictions/types";

function finiteNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const RANKED_PREDICTION_STATUSES = ["OPEN", "CLOSING", "SETTLED", "OPENING", "CLOSED"] as const;

function analyticsFromPrediction(data: Record<string, unknown>): PredictionAnalytics | null {
  if (!isPredictionDirection(data.direction)) {
    return null;
  }

  const entryPrice = finiteNumberOrNull(data.entryPrice);
  const isSettled = data.status === "SETTLED" || data.status === "CLOSED";
  const result = data.result && typeof data.result === "object"
    ? data.result as Record<string, unknown>
    : {};
  const exitPrice = isSettled
    ? finiteNumberOrNull(result.exitPrice)
    : finiteNumberOrNull(data.markPrice);

  if (entryPrice === null || entryPrice <= 0 || exitPrice === null) {
    const returnValue = finiteNumberOrNull(data.markReturnValue ?? result.returnValue);
    if (returnValue === null) {
      return null;
    }
    const predictionScore = computePredictionScore(returnValue);
    return {
      returnValue,
      predictionScore,
      outcome: computePredictionOutcome(returnValue),
      xpEarned: computePredictionXp(predictionScore),
    };
  }

  return computeSettledPredictionAnalytics(data.direction, entryPrice, exitPrice);
}

export async function readUserAnalytics(
  db: FirebaseFirestore.Firestore,
  userId: string,
  stats: Record<string, unknown> = {},
): Promise<UserAnalytics> {
  const sourceStats = stats && typeof stats === "object" ? stats : {};
  const predictionSnapshot = await db.collection("predictions")
    .where("userId", "==", userId)
    .where("status", "in", [...RANKED_PREDICTION_STATUSES])
    .get();
  const publicDocs = predictionSnapshot.docs.filter((doc) => doc.get("visibility") === "PUBLIC");
  const calls = publicDocs
    .map((doc) => ({
      analytics: analyticsFromPrediction(doc.data() as Record<string, unknown>),
      settled: doc.get("status") === "SETTLED" || doc.get("status") === "CLOSED",
    }))
    .filter((call): call is { analytics: PredictionAnalytics; settled: boolean } => call.analytics !== null);
  const callAnalytics = calls.map((call) => call.analytics);
  const settledAnalytics = calls.filter((call) => call.settled).map((call) => call.analytics);
  const computed = computeUserAnalytics(callAnalytics.length, callAnalytics, settledAnalytics.length, settledAnalytics);
  const totalXP = Math.max(finiteNumberOrNull(sourceStats.totalXP) ?? 0, computed.totalXP);
  const level = Math.max(finiteNumberOrNull(sourceStats.level) ?? 1, computeLevel(totalXP));

  return {
    ...computed,
    totalXP,
    level,
  };
}

export async function recomputeUserAnalytics(
  db: FirebaseFirestore.Firestore,
  userId: string,
  nowIso: string,
): Promise<boolean> {
  const userSnapshot = await db.collection("users").doc(userId).get();

  if (!userSnapshot.exists) {
    return false;
  }

  const userData = userSnapshot.data() as Record<string, unknown>;
  const stats = (userData.stats as Record<string, unknown> | undefined) ?? {};
  const computed = await readUserAnalytics(db, userId, stats);

  await userSnapshot.ref.update({
    updatedAt: nowIso,
    "stats.totalCalls": computed.totalCalls,
    "stats.closedPredictions": computed.settledCalls,
    "stats.settledCalls": computed.settledCalls,
    "stats.totalScore": computed.score,
    "stats.totalXP": computed.totalXP,
    "stats.level": computed.level,
    "stats.avgPredictionScore": computed.avgPredictionScore,
    "stats.consistency": computed.consistency,
    "stats.coverage": computed.coverage,
    "stats.avgReturn": computed.avgReturn,
    "stats.winRate": computed.winRate,
    "stats.eligibleForLeaderboard": computed.eligibleForLeaderboard,
    "stats.statusLabel": FieldValue.delete(),
  });

  return true;
}
