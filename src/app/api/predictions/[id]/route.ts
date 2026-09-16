import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { getAiAnalystPublicProfileForUser } from "@/lib/ai-analyst/config";
import { canonicalPredictionStatus, sanitizePredictionThesis, sanitizePredictionThesisTitle } from "@/lib/predictions/types";
import { updatePredictionDetails, validateUpdatePredictionInput } from "@/lib/predictions/service";
import { NextRequest, NextResponse } from "next/server";
import { chinaCompanyId } from "@/lib/market-companies/routes";

function statusFromError(message: string): number {
  if (/not found/i.test(message)) {
    return 404;
  }
  if (/forbidden/i.test(message)) {
    return 403;
  }
  if (/required|must|invalid|only open/i.test(message)) {
    return 400;
  }
  return 500;
}

function isPublicProfile(data: Record<string, unknown> | undefined): boolean {
  const settings = data?.settings;
  if (!settings || typeof settings !== "object") {
    return true;
  }

  return (settings as Record<string, unknown>).isPublic !== false;
}

function numberFromStats(stats: Record<string, unknown>, key: string): number {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getAdminFirestore();

  try {
    const snapshot = await db.collection("predictions").doc(id).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
    }

    const prediction = snapshot.data() as Record<string, unknown>;
    const visibility = prediction.visibility;
    const predictionUserId = typeof prediction.userId === "string" ? prediction.userId.trim() : "";
    const authorDisplayName =
      typeof prediction.authorDisplayName === "string" && prediction.authorDisplayName.trim()
        ? prediction.authorDisplayName.trim()
        : null;

    if (prediction.status === "CANCELED") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (visibility !== "PUBLIC") {
      const decoded = await getDecodedUserFromRequest(request);
      if (!decoded || !predictionUserId || decoded.uid !== predictionUserId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    let authorNickname: string | null = null;
    let authorAccountType: "HUMAN" | "AI_ANALYST" | null = null;
    let authorAiAnalystTheme: "AI_CHIPS" | null = null;
    let authorStats: { level: number; totalPredictions: number } | null = null;
    if (predictionUserId) {
      const userSnapshot = await db.collection("users").doc(predictionUserId).get();
      const userData = userSnapshot.data() as Record<string, unknown> | undefined;
      const nickname = typeof userData?.nickname === "string" ? userData.nickname.trim() : "";
      const aiAnalystProfile = getAiAnalystPublicProfileForUser(userData);
      const stats = userData?.stats && typeof userData.stats === "object"
        ? userData.stats as Record<string, unknown>
        : {};
      const canShowStats = isPublicProfile(userData);
      authorNickname = nickname || null;
      authorAccountType = userData?.accountType === "AI_ANALYST" ? "AI_ANALYST" : "HUMAN";
      authorAiAnalystTheme = aiAnalystProfile?.theme ?? null;
      authorStats = canShowStats
        ? {
            level: numberFromStats(stats, "level") || 1,
            totalPredictions: numberFromStats(stats, "settledCalls") || numberFromStats(stats, "closedPredictions"),
          }
        : null;
    }

    // Resolve display names from the same company records used by the graph.
    // A missing profile must not prevent an existing prediction from opening.
    const ticker = typeof prediction.ticker === "string" ? prediction.ticker.trim().toUpperCase() : "";
    const companyId = chinaCompanyId(ticker) ?? (/^(?:US:)?[A-Z][A-Z0-9.-]{0,19}$/.test(ticker) ? `US:${ticker.replace(/^US:/, "")}` : null);
    let company: { id: string; name: string; names: Record<string, string> } | null = null;
    if (companyId) {
      try {
        const profile = (await db.collection("companies").doc(companyId).get()).data();
        if (profile) company = {
          id: companyId,
          name: typeof profile.name === "string" ? profile.name : ticker,
          names: Object.fromEntries(Object.entries(profile.names && typeof profile.names === "object" ? profile.names : {}).filter(([key, value]) => ["en", "zh-CN"].includes(key) && typeof value === "string" && value.trim())) as Record<string, string>,
        };
      } catch { /* Keep the ticker fallback when the directory is unavailable. */ }
    }

    return NextResponse.json({
      id: snapshot.id,
      ...prediction,
      company,
      status: canonicalPredictionStatus(prediction.status) ?? "CREATED",
      authorDisplayName,
      authorNickname,
      authorAccountType,
      authorAiAnalystTheme,
      authorStats,
      thesisTitle: sanitizePredictionThesisTitle(typeof prediction.thesisTitle === "string" ? prediction.thesisTitle : ""),
      thesis: sanitizePredictionThesis(typeof prediction.thesis === "string" ? prediction.thesis : ""),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch prediction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const decoded = await getDecodedUserFromRequest(request);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const db = getAdminFirestore();

  try {
    const snapshot = await db.collection("predictions").doc(id).get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
    }

    const prediction = snapshot.data() as Record<string, unknown>;
    const baseDate =
      typeof prediction.entryTargetDate === "string" && prediction.entryTargetDate
        ? prediction.entryTargetDate
        : typeof prediction.createdAt === "string"
          ? prediction.createdAt.slice(0, 10)
          : new Date().toISOString().slice(0, 10);
    const input = validateUpdatePredictionInput(await request.json(), baseDate);
    const result = await updatePredictionDetails(id, input, {
      uid: decoded.uid,
      displayName: decoded.name,
      photoURL: decoded.picture,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update prediction";
    return NextResponse.json({ error: message }, { status: statusFromError(message) });
  }
}
