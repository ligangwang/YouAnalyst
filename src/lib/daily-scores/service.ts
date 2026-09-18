import { getAdminFirestore } from "@/lib/firebase/admin";
import { chinaCompanyId } from "@/lib/market-companies/routes";
import { sanitizePredictionThesis, sanitizePredictionThesisTitle } from "@/lib/predictions/types";

export type DailyCallHighlight = {
  predictionId: string;
  userId: string;
  displayName: string | null;
  nickname: string | null;
  ticker: string | null;
  company?: { id: string; name: string; names: Partial<Record<"en" | "zh-CN", string>> };
  direction: "UP" | "DOWN" | null;
  dailyScoreChange: number;
  dailyReturnChange: number | null;
  totalScore: number;
  returnSinceEntry: number | null;
  status: "LIVE" | "SETTLED";
  createdAt: string;
  thesisTitle: string | null;
  thesis: string | null;
};

export type DailyScoresResult = {
  date: string | null;
  callOfTheDay: DailyCallHighlight | null;
  topCalls: DailyCallHighlight[];

};

type UserProfileSummary = {
  displayName: string | null;
  nickname: string | null;
};

type PredictionContentSummary = {
  thesisTitle: string | null;
  thesis: string | null;
  visibility: "PUBLIC" | "PRIVATE" | null;
};

const TOP_CALL_LIMIT = 10;
const TOP_CALL_CANDIDATE_LIMIT = 50;
const FALLBACK_CALL_LIMIT = 200;

function asNumber(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function asNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentFromReturnValue(value: unknown): number | null {
  const parsed = asNumberOrNull(value);
  return parsed === null ? null : parsed * 100;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isDailyScoreDate(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function directionValue(value: unknown): "UP" | "DOWN" | null {
  return value === "UP" || value === "DOWN" ? value : null;
}

function statusValue(value: unknown): "LIVE" | "SETTLED" {
  return value === "SETTLED" || value === "CLOSED" ? "SETTLED" : "LIVE";
}

function dailyReturnChange(data: Record<string, unknown>): number | null {
  const directionDailyReturn = asNumberOrNull(data.directionDailyReturn);
  if (directionDailyReturn !== null) {
    return directionDailyReturn * 100;
  }

  const tickerDailyReturn = asNumberOrNull(data.tickerDailyReturn);
  const direction = directionValue(data.direction);
  if (tickerDailyReturn === null || direction === null) {
    return null;
  }

  return (direction === "UP" ? tickerDailyReturn : -tickerDailyReturn) * 100;
}

async function latestDailyScoreDate(db: FirebaseFirestore.Firestore): Promise<string | null> {
  const snapshot = await db
    .collection("prediction_daily_marks")
    .orderBy("date", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return asString(snapshot.docs[0].get("date"));
}

async function readUserProfiles(
  db: FirebaseFirestore.Firestore,
  userIds: string[],
): Promise<Map<string, UserProfileSummary>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const profiles = new Map<string, UserProfileSummary>();

  if (uniqueIds.length === 0) {
    return profiles;
  }

  const snapshots = await db.getAll(...uniqueIds.map((userId) => db.collection("users").doc(userId)));

  snapshots.forEach((snapshot, index) => {
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;

    profiles.set(uniqueIds[index], {
      displayName: asString(data.displayName),
      nickname: asString(data.nickname),
    });
  });

  return profiles;
}

async function readPredictionContent(
  db: FirebaseFirestore.Firestore,
  predictionIds: string[],
): Promise<Map<string, PredictionContentSummary>> {
  const uniqueIds = Array.from(new Set(predictionIds.filter(Boolean)));
  const content = new Map<string, PredictionContentSummary>();

  if (uniqueIds.length === 0) {
    return content;
  }

  const snapshots = await db.getAll(...uniqueIds.map((predictionId) => db.collection("predictions").doc(predictionId)));

  snapshots.forEach((snapshot, index) => {
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;

    content.set(uniqueIds[index], {
      thesisTitle: sanitizePredictionThesisTitle(typeof data.thesisTitle === "string" ? data.thesisTitle : ""),
      thesis: sanitizePredictionThesis(typeof data.thesis === "string" ? data.thesis : ""),
      visibility: data.visibility === "PRIVATE" ? "PRIVATE" : data.visibility === "PUBLIC" ? "PUBLIC" : null,
    });
  });

  return content;
}

async function dailyCallCandidates(
  db: FirebaseFirestore.Firestore,
  date: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snapshot = await db
    .collection("prediction_daily_marks")
    .where("date", "==", date)
    .orderBy("directionDailyReturn", "desc")
    .orderBy("scoreChange", "desc")
    .orderBy("score", "desc")
    .limit(TOP_CALL_CANDIDATE_LIMIT)
    .get();

  return snapshot.docs;
}

async function fallbackDailyCallCandidates(
  db: FirebaseFirestore.Firestore,
  date: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snapshot = await db
    .collection("prediction_daily_marks")
    .where("date", "==", date)
    .orderBy("scoreChange", "desc")
    .limit(FALLBACK_CALL_LIMIT)
    .get();

  return snapshot.docs;
}

async function topDailyCalls(db: FirebaseFirestore.Firestore, date: string): Promise<DailyCallHighlight[]> {
  let candidateDocs = await dailyCallCandidates(db, date);
  if (candidateDocs.length === 0) {
    candidateDocs = await fallbackDailyCallCandidates(db, date);
  }
  const candidateData = candidateDocs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;

    return {
      data,
      predictionId: asString(data.predictionId) ?? doc.id.split("_")[0] ?? "",
      userId: asString(data.userId) ?? "",
    };
  });

  const rankedCalls = candidateData.map((candidate) => {
    const { data, predictionId, userId } = candidate;

    return {
      predictionId,
      userId,
      displayName: null,
      nickname: null,
      ticker: asString(data.ticker),
      direction: directionValue(data.direction),
      dailyScoreChange: asNumber(data.scoreChange),
      dailyReturnChange: dailyReturnChange(data),
      totalScore: asNumber(data.score),
      returnSinceEntry: percentFromReturnValue(data.markReturnValue),
      status: statusValue(data.status),
      createdAt: asString(data.predictionCreatedAt) ?? asString(data.createdAt) ?? "",
      thesisTitle: null,
      thesis: null,
    };
  })
    .filter((call) => call.predictionId && call.dailyScoreChange !== 0)
    .sort((a, b) => {
      const dailyReturnSort = (b.dailyReturnChange ?? Number.NEGATIVE_INFINITY) -
        (a.dailyReturnChange ?? Number.NEGATIVE_INFINITY);
      const dailyScoreSort = b.dailyScoreChange - a.dailyScoreChange;
      const scoreSort = b.totalScore - a.totalScore;
      const createdSort = a.createdAt.localeCompare(b.createdAt);

      return dailyReturnSort ||
        dailyScoreSort ||
        scoreSort ||
        createdSort ||
        a.predictionId.localeCompare(b.predictionId);
    })
    .slice(0, TOP_CALL_LIMIT);

  const [profilesByUserId, contentByPredictionId] = await Promise.all([
    readUserProfiles(db, rankedCalls.map((call) => call.userId)),
    readPredictionContent(db, rankedCalls.map((call) => call.predictionId)),
  ]);

  return rankedCalls.map((call) => {
    const content = contentByPredictionId.get(call.predictionId) ?? { thesisTitle: null, thesis: null, visibility: null };
    return {
      ...call,
      ...(profilesByUserId.get(call.userId) ?? { displayName: null, nickname: null }),
      thesisTitle: content.thesisTitle,
      thesis: content.thesis,
      visibility: content.visibility,
    };
  })
    .filter((call) => call.visibility === "PUBLIC")
    .map((call) => ({
      predictionId: call.predictionId,
      userId: call.userId,
      displayName: call.displayName,
      nickname: call.nickname,
      ticker: call.ticker,
      direction: call.direction,
      dailyScoreChange: call.dailyScoreChange,
      dailyReturnChange: call.dailyReturnChange,
      totalScore: call.totalScore,
      returnSinceEntry: call.returnSinceEntry,
      status: call.status,
      createdAt: call.createdAt,
      thesisTitle: call.thesisTitle,
      thesis: call.thesis,
    }))
    .slice(0, TOP_CALL_LIMIT);
}

export async function getDailyScores(dateInput?: string | null): Promise<DailyScoresResult> {
  const db = getAdminFirestore();
  const date = isDailyScoreDate(dateInput ?? null) ? dateInput : await latestDailyScoreDate(db);

  if (!date) {
    return {
      date: null,
      callOfTheDay: null,
      topCalls: [],

    };
  }

  const topCalls = await topDailyCalls(db, date);

  const companyIdFor = (ticker: string | null) => {
    const symbol = ticker?.trim().toUpperCase() ?? "";
    return chinaCompanyId(symbol) ?? (/^(?:US:)?[A-Z][A-Z0-9.-]{0,19}$/.test(symbol) ? `US:${symbol.replace(/^US:/, "")}` : null);
  };
  const companyIds = [...new Set(topCalls.map(call => companyIdFor(call.ticker)).filter((id): id is string => id !== null))];
  if (companyIds.length) {
    try {
      const profiles = await db.getAll(...companyIds.map(id => db.collection("companies").doc(id)));
      const companies = new Map(profiles.filter(profile => profile.exists).map(profile => {
        const data = profile.data()!;
        return [profile.id, {
          id: profile.id,
          name: typeof data.name === "string" ? data.name : "",
          names: Object.fromEntries(Object.entries(data.names && typeof data.names === "object" ? data.names : {}).filter(([key, value]) => ["en", "zh-CN"].includes(key) && typeof value === "string" && value.trim())),
        }];
      }));
      for (const call of topCalls) {
        call.company = companies.get(companyIdFor(call.ticker) ?? "");
      }
    } catch { /* Keep daily results available with ticker labels if company lookup fails. */ }
  }

  return {
    date,
    callOfTheDay: topCalls[0] ?? null,
    topCalls,
  };
}
