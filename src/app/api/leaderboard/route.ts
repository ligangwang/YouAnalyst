import { getAdminFirestore } from "@/lib/firebase/admin";
import { readUserAnalytics } from "@/lib/predictions/user-analytics";
import { NextRequest, NextResponse } from "next/server";

type LeaderboardUser = {
  userId: string;
  displayName: string | null;
  nickname: string | null;
  photoURL: string | null;
  totalScore: number;
  settledCalls: number;
  liveCalls: number;
  avgReturn: number;
  totalXP: number;
  level: number;
};

const LEADERBOARD_CANDIDATE_MULTIPLIER = 5;

function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? "50");
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function numberFromStats(stats: Record<string, unknown>, key: string): number {
  const parsed = Number(stats[key]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function liveCallsFromStats(stats: Record<string, unknown>): number {
  return numberFromStats(stats, "openingPredictions") +
    numberFromStats(stats, "openPredictions") +
    numberFromStats(stats, "closingPredictions");
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const candidateLimit = limit * LEADERBOARD_CANDIDATE_MULTIPLIER;

  try {
    const snapshot = await db
        .collection("users")
        .orderBy("stats.totalScore", "desc")
        .limit(candidateLimit)
        .get();

    const users: LeaderboardUser[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
      const analytics = await readUserAnalytics(db, doc.id, stats);
      const totalScore = analytics.score;
      const settledCalls = analytics.settledCalls;
      const user = {
        userId: doc.id,
        displayName: (data.displayName as string | null | undefined) ?? null,
        nickname: typeof data.nickname === "string" && data.nickname.trim() ? data.nickname.trim() : null,
        photoURL: (data.photoURL as string | null | undefined) ?? null,
        totalScore,
        settledCalls,
        liveCalls: liveCallsFromStats(stats),
        avgReturn: analytics.avgReturn,
        totalXP: analytics.totalXP,
        level: analytics.level,
      };

      if (analytics.totalCalls === 0) {
        continue;
      }

      users.push(user);
    }

    users.sort((a, b) =>
      b.totalScore - a.totalScore ||
      b.settledCalls - a.settledCalls ||
      b.avgReturn - a.avgReturn,
    );
    return NextResponse.json({
      items: users.slice(0, limit),
      emergingItems: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch leaderboard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
