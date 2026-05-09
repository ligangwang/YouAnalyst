import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { getAiAnalystPublicProfileForUser } from "@/lib/ai-analyst/config";
import { listPredictions } from "@/lib/predictions/service";
import { readUserAnalytics } from "@/lib/predictions/user-analytics";
import { listWatchlistsForUser } from "@/lib/watchlists/service";
import { NextRequest, NextResponse } from "next/server";

type UserStats = {
  totalPredictions: number;
  totalCalls: number;
  openingPredictions: number;
  openPredictions: number;
  closingPredictions: number;
  closedPredictions: number;
  canceledPredictions: number;
  totalScore: number;
  settledCalls: number;
  totalXP: number;
  level: number;
  avgPredictionScore: number;
  consistency: number;
  coverage: number;
  avgReturn: number;
  winRate: number;
  eligibleForLeaderboard: boolean;
  followersCount: number;
  followingCount: number;
};

type LatestDailyScore = {
  date: string;
  dailyScoreChange: number;
  dailyMarkedPredictions: number;
} | null;

type UserSettings = {
  isPublic: boolean;
  institutionDigestEnabled: boolean;
  institutionDigestCadence: "daily" | "weekly";
  institutionDigestLastSentAt: string | null;
};

function coerceStats(raw: unknown): UserStats {
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    totalPredictions: Number(source.totalPredictions ?? 0),
    totalCalls: Number(source.totalCalls ?? source.totalPredictions ?? 0),
    openingPredictions: Number(source.openingPredictions ?? 0),
    openPredictions: Number(source.openPredictions ?? 0),
    closingPredictions: Number(source.closingPredictions ?? 0),
    closedPredictions: Number(source.closedPredictions ?? 0),
    canceledPredictions: Number(source.canceledPredictions ?? 0),
    totalScore: Number(source.totalScore ?? 0),
    settledCalls: Number(source.settledCalls ?? source.closedPredictions ?? 0),
    totalXP: Number(source.totalXP ?? 0),
    level: Math.max(1, Number(source.level ?? 1)),
    avgPredictionScore: Number(source.avgPredictionScore ?? 0),
    consistency: Number(source.consistency ?? 0),
    coverage: Number(source.coverage ?? 0),
    avgReturn: Number(source.avgReturn ?? 0),
    winRate: Number(source.winRate ?? 0),
    eligibleForLeaderboard: source.eligibleForLeaderboard === true,
    followersCount: Number(source.followersCount ?? 0),
    followingCount: Number(source.followingCount ?? 0),
  };
}

async function coerceStatsWithAnalytics(
  db: FirebaseFirestore.Firestore,
  userId: string,
  raw: unknown,
): Promise<UserStats> {
  const stats = coerceStats(raw);
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const analytics = await readUserAnalytics(db, userId, source);

  return {
    ...stats,
    totalCalls: analytics.totalCalls,
    closedPredictions: analytics.settledCalls,
    settledCalls: analytics.settledCalls,
    totalScore: analytics.score,
    totalXP: analytics.totalXP,
    level: analytics.level,
    avgPredictionScore: analytics.avgPredictionScore,
    consistency: analytics.consistency,
    coverage: analytics.coverage,
    avgReturn: analytics.avgReturn,
    winRate: analytics.winRate,
    eligibleForLeaderboard: analytics.eligibleForLeaderboard,
  };
}

function isPredictionStatus(value: string | null): value is "LIVE" | "FINAL" | "SETTLED" | "CREATED" | "OPEN" | "CLOSING" {
  return value === "LIVE" || value === "FINAL" || value === "SETTLED" || value === "CREATED" || value === "OPEN" || value === "CLOSING";
}

function coerceSettings(raw: unknown): UserSettings {
  const settings = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const cadence = settings.institutionDigestCadence === "daily" ? "daily" : "weekly";

  return {
    isPublic: settings.isPublic !== false,
    institutionDigestEnabled: settings.institutionDigestEnabled === true,
    institutionDigestCadence: cadence,
    institutionDigestLastSentAt: typeof settings.institutionDigestLastSentAt === "string" ? settings.institutionDigestLastSentAt : null,
  };
}

async function readLatestDailyScore(userId: string): Promise<LatestDailyScore> {
  const snapshot = await getAdminFirestore()
    .collection("user_daily_scores")
    .where("userId", "==", userId)
    .orderBy("date", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const data = snapshot.docs[0].data() as Record<string, unknown>;
  const date = typeof data.date === "string" ? data.date : null;
  if (!date) {
    return null;
  }

  return {
    date,
    dailyScoreChange: Number(data.dailyScoreChange ?? 0),
    dailyMarkedPredictions: Number(data.dailyMarkedPredictions ?? 0),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getAdminFirestore();

  try {
    const decoded = await getDecodedUserFromRequest(request);
    const isOwner = Boolean(decoded && decoded.uid === id);
    const relationship =
      decoded && decoded.uid !== id
        ? {
            isFollowing: (await db.collection("users").doc(decoded.uid).collection("following").doc(id).get()).exists,
          }
        : {
            isFollowing: false,
          };

    const statusParam = request.nextUrl.searchParams.get("status");
    const status = isPredictionStatus(statusParam) ? statusParam : undefined;

    const predictions = await listPredictions({
      userId: id,
      includePrivate: isOwner,
      status,
      limit: 25,
      cursorCreatedAt: request.nextUrl.searchParams.get("cursorCreatedAt") ?? undefined,
    });

    const userSnapshot = await db.collection("users").doc(id).get();
    const [latestDailyScore, watchlists] = await Promise.all([
      readLatestDailyScore(id),
      listWatchlistsForUser(id),
    ]);

    if (!userSnapshot.exists) {
      // If user document doesn't exist, check if they have predictions
      // If they do, create a minimal profile from prediction data
      if (predictions.items.length === 0) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Build profile from first prediction's author data and create user doc
      const firstPrediction = predictions.items[0];
      const profileData = {
        displayName: firstPrediction.authorDisplayName ?? null,
        photoURL: firstPrediction.authorPhotoURL ?? null,
        authProviders: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        bio: "",
        nickname: null,
        stats: {
          totalPredictions: 0,
          totalCalls: 0,
          openingPredictions: 0,
          openPredictions: 0,
          closingPredictions: 0,
          closedPredictions: 0,
          canceledPredictions: 0,
          totalScore: 0,
          settledCalls: 0,
          totalXP: 0,
          level: 1,
          avgPredictionScore: 0,
          consistency: 0,
          coverage: 0,
          avgReturn: 0,
          winRate: 0,
          eligibleForLeaderboard: false,
          followersCount: 0,
          followingCount: 0,
        },
        settings: {
          isPublic: true,
          institutionDigestEnabled: false,
          institutionDigestCadence: "weekly",
          institutionDigestLastSentAt: null,
        },
      };

      // Create the user profile document if it doesn't exist
      try {
        await db.collection("users").doc(id).set(profileData, { merge: true });
      } catch {
        // If set fails, continue anyway - we have the data to return
      }

      const stats = await coerceStatsWithAnalytics(db, id, profileData.stats);

      return NextResponse.json({
        profile: {
          id,
          displayName: profileData.displayName,
          photoURL: profileData.photoURL,
          nickname: profileData.nickname,
          bio: profileData.bio,
          accountType: "HUMAN",
          aiAnalyst: null,
          stats,
          latestDailyScore,
          settings: profileData.settings,
        },
        relationship,
        watchlists,
        predictions: predictions.items,
        nextCursor: predictions.nextCursor,
      });
    }

    const userData = userSnapshot.data() as Record<string, unknown>;
    const settings = coerceSettings(userData.settings);

    if (!settings.isPublic && !isOwner) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const stats = await coerceStatsWithAnalytics(db, id, userData.stats);
    const aiAnalyst = getAiAnalystPublicProfileForUser(userData);

    return NextResponse.json({
      profile: {
        id,
        displayName: userData.displayName ?? null,
        photoURL: userData.photoURL ?? null,
        nickname: typeof userData.nickname === "string" ? userData.nickname : null,
        bio: userData.bio ?? "",
        accountType: userData.accountType === "AI_ANALYST" ? "AI_ANALYST" : "HUMAN",
        aiAnalyst,
        stats,
        latestDailyScore,
        settings: isOwner
          ? settings
          : {
              isPublic: settings.isPublic,
              institutionDigestEnabled: false,
              institutionDigestCadence: "weekly",
              institutionDigestLastSentAt: null,
            },
      },
      relationship,
      watchlists,
      predictions: predictions.items,
      nextCursor: predictions.nextCursor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch user profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded || decoded.uid !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if ("nickname" in body) {
    const nickname = body.nickname;
    if (nickname !== null && (typeof nickname !== "string" || nickname.length > 30)) {
      return NextResponse.json({ error: "nickname must be a string up to 30 characters or null" }, { status: 400 });
    }
    updates.nickname = nickname === "" ? null : nickname;
  }

  if ("bio" in body) {
    const bio = body.bio;
    if (typeof bio !== "string" || bio.length > 500) {
      return NextResponse.json({ error: "bio must be a string up to 500 characters" }, { status: 400 });
    }
    updates.bio = bio;
  }

  if ("settings" in body && body.settings && typeof body.settings === "object") {
    const settings = body.settings as Record<string, unknown>;
    if (typeof settings.isPublic === "boolean") {
      updates["settings.isPublic"] = settings.isPublic;
    }
    if (typeof settings.institutionDigestEnabled === "boolean") {
      updates["settings.institutionDigestEnabled"] = settings.institutionDigestEnabled;
    }
    if (settings.institutionDigestCadence === "daily" || settings.institutionDigestCadence === "weekly") {
      updates["settings.institutionDigestCadence"] = settings.institutionDigestCadence;
    }
  }

  try {
    const db = getAdminFirestore();
    await db.collection("users").doc(id).update(updates);
    return NextResponse.json({ updated: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update user profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
