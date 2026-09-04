import type { PredictionDirection } from "@/lib/predictions/types";

export const TANH_SCALE = 0.30;
export const SCORE_SCALE = 1000;
export const CONSISTENCY_PRIOR_WIN = 3;
export const CONSISTENCY_PRIOR_TOTAL = 6;
export const COVERAGE_OFFSET = 10;
export const XP_BASE = 50;
export const XP_MULTIPLIER = 0.2;
export const LEVEL_FACTOR = 100;
export const LEADERBOARD_MIN_CALLS = 1;

const ANALYST_LEVEL_NAMES = [
  "New Analyst",
  "Junior Analyst",
  "Rising Analyst",
  "Developing Analyst",
  "Skilled Analyst",
  "Advanced Analyst",
  "Senior Analyst",
  "Expert Analyst",
  "Elite Analyst",
  "Master Analyst",
] as const;

export type PredictionAnalytics = {
  returnValue: number;
  predictionScore: number;
  outcome: number;
  xpEarned: number;
};

export type SettledPredictionAnalytics = PredictionAnalytics;

export type UserAnalytics = {
  totalCalls: number;
  settledCalls: number;
  totalXP: number;
  level: number;
  score: number;
  avgPredictionScore: number;
  consistency: number;
  coverage: number;
  avgReturn: number;
  winRate: number;
  eligibleForLeaderboard: boolean;
};

export function computePredictionReturn(
  direction: PredictionDirection,
  entryPrice: number,
  exitPrice: number,
): number {
  const directionMultiplier = direction === "UP" ? 1 : -1;
  return directionMultiplier * ((exitPrice - entryPrice) / entryPrice);
}

export function computePredictionScore(returnValue: number): number {
  return Math.round(SCORE_SCALE * Math.tanh(returnValue / TANH_SCALE));
}

export function computePredictionOutcome(returnValue: number): number {
  if (returnValue > 0) {
    return 1;
  }
  if (returnValue < 0) {
    return 0;
  }
  return 0.5;
}

export function computePredictionXp(predictionScore: number): number {
  return Math.max(0, Math.round(XP_BASE + XP_MULTIPLIER * predictionScore));
}

export function computeLevel(totalXP: number): number {
  return Math.floor(Math.sqrt(Math.max(0, totalXP) / LEVEL_FACTOR)) + 1;
}

export function nextLevelXP(level: number): number {
  return LEVEL_FACTOR * Math.max(1, level) ** 2;
}

export function analystLevelName(level: number): string {
  const index = Math.max(1, Math.floor(level)) - 1;
  return ANALYST_LEVEL_NAMES[Math.min(index, ANALYST_LEVEL_NAMES.length - 1)];
}

export function computeSettledPredictionAnalytics(
  direction: PredictionDirection,
  entryPrice: number,
  exitPrice: number,
): SettledPredictionAnalytics {
  const returnValue = computePredictionReturn(direction, entryPrice, exitPrice);
  const predictionScore = computePredictionScore(returnValue);

  return {
    returnValue,
    predictionScore,
    outcome: computePredictionOutcome(returnValue),
    xpEarned: computePredictionXp(predictionScore),
  };
}

export function computeUserAnalytics(
  totalCalls: number,
  calls: PredictionAnalytics[],
  settledCallCount = calls.length,
  xpCalls = calls,
): UserAnalytics {
  const n = calls.length;

  if (n === 0) {
    return {
      totalCalls,
      settledCalls: 0,
      totalXP: 0,
      level: 1,
      score: 0,
      avgPredictionScore: 0,
      consistency: 0,
      coverage: 0,
      avgReturn: 0,
      winRate: 0,
      eligibleForLeaderboard: false,
    };
  }

  const totalPredictionScore = calls.reduce((sum, call) => sum + call.predictionScore, 0);
  const totalOutcome = calls.reduce((sum, call) => sum + call.outcome, 0);
  const totalReturn = calls.reduce((sum, call) => sum + call.returnValue, 0);
  const totalXP = xpCalls.reduce((sum, call) => sum + call.xpEarned, 0);
  const avgPredictionScore = totalPredictionScore / n;
  const consistency = (totalOutcome + CONSISTENCY_PRIOR_WIN) / (n + CONSISTENCY_PRIOR_TOTAL);
  const coverage = n / (n + COVERAGE_OFFSET);
  const score = Math.round(
    coverage * (
      0.85 * avgPredictionScore +
      300 * (consistency - 0.5)
    ),
  );

  return {
    totalCalls,
    settledCalls: settledCallCount,
    totalXP,
    level: computeLevel(totalXP),
    score,
    avgPredictionScore,
    consistency,
    coverage,
    avgReturn: totalReturn / n,
    winRate: totalOutcome / n,
    eligibleForLeaderboard: n >= LEADERBOARD_MIN_CALLS,
  };
}
