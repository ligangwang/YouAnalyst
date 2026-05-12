import { getAdminFirestore } from "@/lib/firebase/admin";
import { sanitizePredictionThesis, sanitizePredictionThesisTitle } from "@/lib/predictions/types";

export type DailyCallHighlight = {
  predictionId: string;
  userId: string;
  displayName: string | null;
  nickname: string | null;
  ticker: string | null;
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

export type DailyInstitutionalMove = {
  ticker: string;
  nameOfIssuer: string;
  reportDate: string;
  managerCount: number;
  valueChangeUsd: number;
  shareChange: number;
  newManagers: number;
  increasedManagers: number;
  reducedManagers: number;
  soldOutManagers: number;
};

export type DailyInsiderMove = {
  ticker: string;
  issuerName: string;
  filingDate: string;
  transactionCode: "P" | "S";
  totalValueUsd: number;
  totalShares: number;
  insiderCount: number;
  transactionCount: number;
  latestTransactionDate: string;
};

export type DailyScoresResult = {
  date: string | null;
  callOfTheDay: DailyCallHighlight | null;
  topCalls: DailyCallHighlight[];
  institutionalMoves: {
    increases: DailyInstitutionalMove[];
    decreases: DailyInstitutionalMove[];
  };
  insiderMoves: {
    purchases: DailyInsiderMove[];
    sales: DailyInsiderMove[];
  };
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
const INSTITUTIONAL_MOVE_LIMIT = 5;
const INSTITUTIONAL_CHANGE_SCAN_LIMIT = 3000;
const INSIDER_MOVE_LIMIT = 5;
const INSIDER_TRANSACTION_SCAN_LIMIT = 3000;

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

function changeStatusValue(value: unknown): "NEW" | "INCREASED" | "REDUCED" | "SOLD_OUT" | "UNCHANGED" | null {
  return value === "NEW" || value === "INCREASED" || value === "REDUCED" || value === "SOLD_OUT" || value === "UNCHANGED"
    ? value
    : null;
}

function insiderTransactionCode(value: unknown): "P" | "S" | null {
  return value === "P" || value === "S" ? value : null;
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

async function latestInstitutionalMoves(db: FirebaseFirestore.Firestore): Promise<DailyScoresResult["institutionalMoves"]> {
  const snapshot = await db
    .collection("institutional_holding_changes")
    .orderBy("updatedAt", "desc")
    .limit(INSTITUTIONAL_CHANGE_SCAN_LIMIT)
    .get();
  const increasesByTickerReport = new Map<string, DailyInstitutionalMove & { managerCiks: Set<string> }>();
  const decreasesByTickerReport = new Map<string, DailyInstitutionalMove & { managerCiks: Set<string> }>();

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const ticker = asString(data.ticker);
    const nameOfIssuer = asString(data.nameOfIssuer);
    const reportDate = asString(data.reportDate);
    const managerCik = asString(data.managerCik);
    const status = changeStatusValue(data.status);
    const valueChangeUsd = asNumber(data.valueChangeUsd);
    const shareChange = asNumber(data.shareChange);
    const target =
      valueChangeUsd > 0 && (status === "NEW" || status === "INCREASED")
        ? increasesByTickerReport
        : valueChangeUsd < 0 && (status === "REDUCED" || status === "SOLD_OUT")
          ? decreasesByTickerReport
          : null;

    if (!ticker || !nameOfIssuer || !reportDate || !managerCik || !status || !target) {
      continue;
    }

    const key = `${ticker}_${reportDate}`;
    const existing = target.get(key) ?? {
      ticker,
      nameOfIssuer,
      reportDate,
      managerCount: 0,
      valueChangeUsd: 0,
      shareChange: 0,
      newManagers: 0,
      increasedManagers: 0,
      reducedManagers: 0,
      soldOutManagers: 0,
      managerCiks: new Set<string>(),
    };

    existing.valueChangeUsd += valueChangeUsd;
    existing.shareChange += shareChange;
    existing.managerCiks.add(managerCik);
    existing.managerCount = existing.managerCiks.size;
    existing.newManagers += status === "NEW" ? 1 : 0;
    existing.increasedManagers += status === "INCREASED" ? 1 : 0;
    existing.reducedManagers += status === "REDUCED" ? 1 : 0;
    existing.soldOutManagers += status === "SOLD_OUT" ? 1 : 0;
    target.set(key, existing);
  }

  function finalize(items: Array<DailyInstitutionalMove & { managerCiks: Set<string> }>): DailyInstitutionalMove[] {
    return items.map((item) => ({
      ticker: item.ticker,
      nameOfIssuer: item.nameOfIssuer,
      reportDate: item.reportDate,
      managerCount: item.managerCount,
      valueChangeUsd: item.valueChangeUsd,
      shareChange: item.shareChange,
      newManagers: item.newManagers,
      increasedManagers: item.increasedManagers,
      reducedManagers: item.reducedManagers,
      soldOutManagers: item.soldOutManagers,
    }));
  }

  return {
    increases: finalize([...increasesByTickerReport.values()]
      .sort((left, right) => right.valueChangeUsd - left.valueChangeUsd || right.managerCount - left.managerCount)
      .slice(0, INSTITUTIONAL_MOVE_LIMIT)),
    decreases: finalize([...decreasesByTickerReport.values()]
      .sort((left, right) => left.valueChangeUsd - right.valueChangeUsd || right.managerCount - left.managerCount)
      .slice(0, INSTITUTIONAL_MOVE_LIMIT)),
  };
}

async function latestInsiderMoves(db: FirebaseFirestore.Firestore): Promise<DailyScoresResult["insiderMoves"]> {
  const snapshot = await db
    .collection("insider_transactions")
    .orderBy("updatedAt", "desc")
    .limit(INSIDER_TRANSACTION_SCAN_LIMIT)
    .get();
  const purchasesByTickerFiling = new Map<string, DailyInsiderMove & { insiderKeys: Set<string> }>();
  const salesByTickerFiling = new Map<string, DailyInsiderMove & { insiderKeys: Set<string> }>();

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const ticker = asString(data.ticker);
    const issuerName = asString(data.issuerName);
    const filingDate = asString(data.filingDate);
    const transactionDate = asString(data.transactionDate);
    const transactionCode = insiderTransactionCode(data.transactionCode);
    const valueUsd = asNumber(data.valueUsd);
    const shares = asNumber(data.shares);

    if (!ticker || !issuerName || !filingDate || !transactionDate || !transactionCode || valueUsd <= 0 || shares <= 0) {
      continue;
    }

    const target = transactionCode === "P" ? purchasesByTickerFiling : salesByTickerFiling;
    const insiderKey = asString(data.reportingOwnerCik) ?? asString(data.reportingOwnerName) ?? doc.id;
    const key = `${ticker}_${filingDate}_${transactionCode}`;
    const existing = target.get(key) ?? {
      ticker,
      issuerName,
      filingDate,
      transactionCode,
      totalValueUsd: 0,
      totalShares: 0,
      insiderCount: 0,
      transactionCount: 0,
      latestTransactionDate: transactionDate,
      insiderKeys: new Set<string>(),
    };

    existing.totalValueUsd += valueUsd;
    existing.totalShares += shares;
    existing.transactionCount += 1;
    existing.latestTransactionDate = existing.latestTransactionDate.localeCompare(transactionDate) > 0
      ? existing.latestTransactionDate
      : transactionDate;
    existing.insiderKeys.add(insiderKey);
    existing.insiderCount = existing.insiderKeys.size;
    target.set(key, existing);
  }

  function finalize(items: Array<DailyInsiderMove & { insiderKeys: Set<string> }>): DailyInsiderMove[] {
    return items
      .sort((left, right) => (
        right.totalValueUsd - left.totalValueUsd ||
        right.insiderCount - left.insiderCount ||
        right.latestTransactionDate.localeCompare(left.latestTransactionDate)
      ))
      .slice(0, INSIDER_MOVE_LIMIT)
      .map((item) => ({
        ticker: item.ticker,
        issuerName: item.issuerName,
        filingDate: item.filingDate,
        transactionCode: item.transactionCode,
        totalValueUsd: item.totalValueUsd,
        totalShares: item.totalShares,
        insiderCount: item.insiderCount,
        transactionCount: item.transactionCount,
        latestTransactionDate: item.latestTransactionDate,
      }));
  }

  return {
    purchases: finalize([...purchasesByTickerFiling.values()]),
    sales: finalize([...salesByTickerFiling.values()]),
  };
}

export async function getDailyScores(dateInput?: string | null): Promise<DailyScoresResult> {
  const db = getAdminFirestore();
  const date = isDailyScoreDate(dateInput ?? null) ? dateInput : await latestDailyScoreDate(db);

  if (!date) {
    return {
      date: null,
      callOfTheDay: null,
      topCalls: [],
      institutionalMoves: {
        increases: [],
        decreases: [],
      },
      insiderMoves: {
        purchases: [],
        sales: [],
      },
    };
  }

  const [topCalls, institutionalMoves, insiderMoves] = await Promise.all([
    topDailyCalls(db, date),
    latestInstitutionalMoves(db),
    latestInsiderMoves(db),
  ]);

  return {
    date,
    callOfTheDay: topCalls[0] ?? null,
    topCalls,
    institutionalMoves,
    insiderMoves,
  };
}
