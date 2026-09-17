import { assertSamePost, type Post, type PostInput } from "@/lib/posts/model";
import { predictionInstrument, chinaTargetDate } from "./instrument";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { canUseProFeaturesForUserData } from "@/lib/features";
import { getAiAnalystPublicProfileForUser } from "@/lib/ai-analyst/config";
import { assertWatchlistCanReceivePrediction } from "@/lib/watchlists/service";
import {
  canonicalPredictionStatus,
  isPredictionDirection,
  isPredictionTimeHorizonUnit,
  isPredictionVisibility,
  MAX_PREDICTION_THESIS_TITLE_LENGTH,
  MAX_PREDICTION_THESIS_LENGTH,
  normalizeTicker,
  sanitizePredictionThesis,
  sanitizePredictionThesisTitle,
  type CreatePredictionInput,
  type Prediction,
  type PredictionComment,
  type PredictionStatus,
  type PredictionTimeHorizon,
  type PredictionTimeHorizonUnit,
  type UpdatePredictionInput,
} from "@/lib/predictions/types";

type AuthedUser = {
  uid: string;
  displayName?: string | null;
  photoURL?: string | null;
};

type InternalCreatePredictionOptions = {
  db?: FirebaseFirestore.Firestore;
  post?: { id: string; input: PostInput };
  sourceType?: "HUMAN" | "AI_ANALYST";
  generation?: Prediction["generation"];
};

type ListPredictionsInput = {
  limit?: number;
  status?: PredictionStatus | "ACTIVE" | "LIVE" | "FINAL" | "SETTLED";
  userId?: string;
  cursorCreatedAt?: string;
  includePrivate?: boolean;
  sort?: "createdAt" | "performance";
};

type ListPredictionsResult = {
  items: Array<Prediction & {
    id: string;
    authorNickname: string | null;
    authorAccountType: "HUMAN" | "AI_ANALYST" | null;
    authorAiAnalystTheme: "AI_CHIPS" | null;
    authorStats: {
      level: number;
      totalPredictions: number;
    } | null;
  }>;
  nextCursor: string | null;
};

const PUBLIC_PREDICTION_STATUSES = ["CREATED", "OPEN", "SETTLED", "OPENING", "CLOSING", "CLOSED"] as const;
export const PUBLIC_FEED_PREVIEW_LIMIT = 10;
const ACTIVE_PREDICTION_STATUSES = ["CREATED", "OPEN", "OPENING", "CLOSING"] as const;
const MAX_ACTIVE_PREDICTIONS_PER_TICKER = 1;
const CANCEL_WINDOW_MS = 5 * 60 * 1000;
const TIME_HORIZON_LIMITS: Record<PredictionTimeHorizonUnit, number> = {
  DAYS: 3650,
  MONTHS: 120,
  YEARS: 10,
};

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

function getCurrentEasternDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  return parsed.toISOString().slice(0, 10);
}

function addYears(date: string, years: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
}

function hasCancelWindow(timestamp: string | null | undefined, now = Date.now()): boolean {
  const parsed = Date.parse(timestamp ?? "");
  return !Number.isNaN(parsed) && now - parsed <= CANCEL_WINDOW_MS;
}

function hasCreateCancelWindowExpired(prediction: Prediction, now = Date.now()): boolean {
  return !hasCancelWindow(prediction.createdAt, now);
}

function computeTimeHorizonTargetDate(baseDate: string, value: number, unit: PredictionTimeHorizonUnit): string {
  if (unit === "DAYS") {
    return addDays(baseDate, value);
  }
  if (unit === "MONTHS") {
    return addMonths(baseDate, value);
  }
  return addYears(baseDate, value);
}

function eodRunDocId(runDate: string, market = "US"): string {
  return [market, runDate].join("_");
}

function predictionPerformanceValue(
  prediction: Prediction & {
    result: Prediction["result"];
    markReturnValue?: number | null;
  },
): number | null {
  if (typeof prediction.result?.returnValue === "number" && Number.isFinite(prediction.result.returnValue)) {
    return prediction.result.returnValue;
  }

  if (typeof prediction.markReturnValue === "number" && Number.isFinite(prediction.markReturnValue)) {
    return prediction.markReturnValue;
  }

  return null;
}

function comparePredictionsByPerformance(
  a: Prediction & { createdAt: string; result: Prediction["result"]; markReturnValue?: number | null },
  b: Prediction & { createdAt: string; result: Prediction["result"]; markReturnValue?: number | null },
): number {
  const aPerformance = predictionPerformanceValue(a);
  const bPerformance = predictionPerformanceValue(b);

  if (aPerformance !== null && bPerformance !== null && aPerformance !== bPerformance) {
    return bPerformance - aPerformance;
  }

  if (aPerformance !== null && bPerformance === null) {
    return -1;
  }

  if (aPerformance === null && bPerformance !== null) {
    return 1;
  }

  return b.createdAt.localeCompare(a.createdAt);
}

function targetDateFromRunStatus(today: string, status: unknown): string {
  return status === "STARTED" || status === "COMPLETED" || status === "FAILED"
    ? addDays(today, 1)
    : today;
}

async function resolveEodTargetDateInTransaction(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  ticker: string,
): Promise<string> {
  if (predictionInstrument(ticker)?.market === "CN_A") return chinaTargetDate();
  const today = getCurrentEasternDate();
  const snapshot = await tx.get(db.collection("eod_runs").doc(eodRunDocId(today)));
  return targetDateFromRunStatus(today, snapshot.exists ? snapshot.get("status") : null);
}

export async function listPredictions(input: ListPredictionsInput): Promise<ListPredictionsResult> {
  const db = getAdminFirestore();
  const clampedLimit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const status = input.status;
  const userId = input.userId?.trim() ?? "";
  const includePrivate = input.includePrivate === true;
  const sort = input.sort === "performance" ? "performance" : "createdAt";

  let query = db.collection("predictions") as FirebaseFirestore.Query;

  if (userId) {
    query = query.where("userId", "==", userId);
    if (!includePrivate) {
      query = query.where("visibility", "==", "PUBLIC");
    }
  } else {
    query = query.where("visibility", "==", "PUBLIC");
  }

  if (status === "CANCELED") {
    return { items: [], nextCursor: null };
  }

  if (status === "ACTIVE" || status === "LIVE") {
    query = query.where("status", "in", ACTIVE_PREDICTION_STATUSES);
  } else if (status === "FINAL" || status === "SETTLED") {
    query = query.where("status", "in", ["SETTLED", "CLOSED"]);
  } else if (status) {
    if (status === "CREATED") {
      query = query.where("status", "in", ["CREATED", "OPENING"]);
    } else {
      query = query.where("status", "==", status);
    }
  }

  const queryLimit = sort === "performance"
    ? Math.min(Math.max(clampedLimit * 5, 120), 300)
    : clampedLimit + 1;
  query = query.orderBy("createdAt", "desc").limit(queryLimit);

  const cursor = input.cursorCreatedAt?.trim();
  if (cursor && sort === "createdAt") {
    const cursorDate = new Date(cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      query = query.startAfter(cursorDate.toISOString());
    }
  }

  const snapshot = await query.get();
  const docs = snapshot.docs;
  const hasMore = sort === "createdAt" && docs.length > clampedLimit;
  const selected = hasMore ? docs.slice(0, clampedLimit) : docs;
  const visibleSelected = selected.filter((doc) => PUBLIC_PREDICTION_STATUSES.includes(doc.get("status") as (typeof PUBLIC_PREDICTION_STATUSES)[number]));
  const items = visibleSelected.map((doc) => {
    const prediction = doc.data() as Prediction;
    const status = canonicalPredictionStatus(prediction.status) ?? "CREATED";

    return {
      id: doc.id,
      ...prediction,
      status,
      thesisTitle: sanitizePredictionThesisTitle(prediction.thesisTitle),
      thesis: sanitizePredictionThesis(prediction.thesis),
    };
  });

  const uniqueUserIds = Array.from(new Set(items.map((item) => item.userId).filter(Boolean)));
  const authorEntries = await Promise.all(
    uniqueUserIds.map(async (id) => {
      const userSnapshot = await db.collection("users").doc(id).get();
      const userData = userSnapshot.data() as Record<string, unknown> | undefined;
      const nickname = typeof userData?.nickname === "string" ? userData.nickname : null;
      const aiAnalystProfile = getAiAnalystPublicProfileForUser(userData);
      const stats = userData?.stats && typeof userData.stats === "object"
        ? userData.stats as Record<string, unknown>
        : {};
      const canShowStats = isPublicProfile(userData);
      return [id, {
        nickname,
        accountType: userData?.accountType === "AI_ANALYST" ? "AI_ANALYST" : "HUMAN",
        aiAnalystTheme: aiAnalystProfile?.theme ?? null,
        level: canShowStats ? numberFromStats(stats, "level") || 1 : null,
        totalPredictions: canShowStats ? numberFromStats(stats, "settledCalls") || numberFromStats(stats, "closedPredictions") : null,
      }] as const;
    }),
  );
  const authorByUserId = new Map(authorEntries);

  const itemsWithNickname = items.map((item) => ({
    ...item,
    authorNickname: authorByUserId.get(item.userId)?.nickname ?? null,
    authorAccountType: authorByUserId.get(item.userId)?.accountType ?? null,
    authorAiAnalystTheme: authorByUserId.get(item.userId)?.aiAnalystTheme ?? null,
    authorStats:
      authorByUserId.get(item.userId)?.level === null ||
      authorByUserId.get(item.userId)?.totalPredictions === null
        ? null
        : {
            level: authorByUserId.get(item.userId)?.level ?? 1,
            totalPredictions: authorByUserId.get(item.userId)?.totalPredictions ?? 0,
          },
  }));

  if (sort === "performance") {
    itemsWithNickname.sort(comparePredictionsByPerformance);
  }

  const nextCursor = sort === "createdAt" && hasMore && selected.length > 0 ? selected[selected.length - 1].get("createdAt") : null;

  return {
    items: sort === "performance" ? itemsWithNickname.slice(0, clampedLimit) : itemsWithNickname,
    nextCursor: typeof nextCursor === "string" ? nextCursor : null,
  };
}

export function validateCreatePredictionInput(raw: unknown): CreatePredictionInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid request body");
  }

  const input = raw as Record<string, unknown>;
  const ticker = typeof input.ticker === "string" ? normalizeTicker(input.ticker) : "";
  const direction = input.direction;
  const watchlistId = typeof input.watchlistId === "string" ? input.watchlistId.trim() : "";
  const thesisTitle = typeof input.thesisTitle === "string" ? sanitizePredictionThesisTitle(input.thesisTitle) : "";
  const thesis = typeof input.thesis === "string" ? sanitizePredictionThesis(input.thesis) : "";
  const visibility = input.visibility;

  if (!predictionInstrument(ticker)) {
    throw new Error("Invalid ticker: use a US symbol or an exchange-qualified A-share code");
  }

  if (!isPredictionDirection(direction)) {
    throw new Error("direction must be UP or DOWN");
  }


  validatePredictionText(thesisTitle, thesis);

  const resolvedVisibility = isPredictionVisibility(visibility) ? visibility : "PUBLIC";

  return {
    ticker,
    direction,
    watchlistId,
    thesisTitle,
    thesis,
    timeHorizon: validateTimeHorizonInput(input.timeHorizon, predictionInstrument(ticker)?.market === "CN_A" ? chinaTargetDate() : getCurrentEasternDate()),
    visibility: resolvedVisibility,
  };
}

function validatePredictionText(thesisTitle: string, thesis: string): void {
  if (thesisTitle.length > MAX_PREDICTION_THESIS_TITLE_LENGTH) {
    throw new Error(`title must be <= ${MAX_PREDICTION_THESIS_TITLE_LENGTH} chars`);
  }

  if (thesis.length > MAX_PREDICTION_THESIS_LENGTH) {
    throw new Error(`thesis must be <= ${MAX_PREDICTION_THESIS_LENGTH} chars`);
  }
}

function validateUpdatedPredictionText(thesisTitle: string, thesis: string): void {
  if (thesisTitle.length > MAX_PREDICTION_THESIS_TITLE_LENGTH) {
    throw new Error(`title must be <= ${MAX_PREDICTION_THESIS_TITLE_LENGTH} chars`);
  }

  if (thesis.length > MAX_PREDICTION_THESIS_LENGTH) {
    throw new Error(`thesis must be <= ${MAX_PREDICTION_THESIS_LENGTH} chars`);
  }
}

function validateTimeHorizonInput(raw: unknown, baseDate: string): PredictionTimeHorizon | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  if (typeof raw !== "object") {
    throw new Error("open until must be an object or null");
  }

  const input = raw as Record<string, unknown>;
  const unit = input.unit;
  const value = Number(input.value);

  if (!isPredictionTimeHorizonUnit(unit)) {
    throw new Error("open until unit must be DAYS, MONTHS, or YEARS");
  }

  if (!Number.isInteger(value) || value < 1 || value > TIME_HORIZON_LIMITS[unit]) {
    throw new Error(`open until value must be 1-${TIME_HORIZON_LIMITS[unit]} for ${unit}`);
  }

  return {
    value,
    unit,
    targetDate: computeTimeHorizonTargetDate(baseDate, value, unit),
  };
}

async function readLatestEodTradingDateForTicker(ticker: string): Promise<string | null> {
  const snapshot = await getAdminFirestore()
    .collection("eod_prices")
    .where("ticker", "==", ticker)
    .orderBy("tradingDate", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const tradingDate = snapshot.docs[0].get("tradingDate");
  return typeof tradingDate === "string" && tradingDate ? tradingDate : null;
}

async function assertOpenUntilAfterLatestEod(ticker: string, timeHorizon: PredictionTimeHorizon | null): Promise<void> {
  if (!timeHorizon) {
    return;
  }

  const latestTradingDate = await readLatestEodTradingDateForTicker(ticker);
  if (!latestTradingDate || timeHorizon.targetDate > latestTradingDate) {
    return;
  }

  throw new Error(
    `Open until date must be after the latest market date for this ticker. Current open-until date is ${timeHorizon.targetDate}; latest market date is ${latestTradingDate}. Choose a longer period or select No limit.`,
  );
}

async function listActivePredictionsForTickerInTransaction(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
  ticker: string,
): Promise<Array<{ id: string; watchlistId: string; status: PredictionStatus }>> {
  const snapshot = await tx.get(
    db.collection("predictions")
      .where("userId", "==", userId)
      .where("ticker", "==", ticker),
  );

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Prediction;
      const status = canonicalPredictionStatus(data.status);
      const watchlistId = typeof data.watchlistId === "string" ? data.watchlistId.trim() : "";
      if (!status || !ACTIVE_PREDICTION_STATUSES.includes(status as (typeof ACTIVE_PREDICTION_STATUSES)[number])) {
        return null;
      }

      return {
        id: doc.id,
        watchlistId,
        status,
      };
    })
    .filter((prediction): prediction is { id: string; watchlistId: string; status: PredictionStatus } => prediction !== null);
}

function assertTickerActivePredictionLimit(
  activePredictions: Array<{ id: string; watchlistId: string }>,
  targetWatchlistId: string,
  options: { excludePredictionId?: string } = {},
): void {
  const relevantPredictions = options.excludePredictionId
    ? activePredictions.filter((prediction) => prediction.id !== options.excludePredictionId)
    : activePredictions;

  if (relevantPredictions.some((prediction) => prediction.watchlistId === targetWatchlistId)) {
    throw new Error("An active prediction for this ticker already exists in that watchlist.");
  }

  if (relevantPredictions.length >= MAX_ACTIVE_PREDICTIONS_PER_TICKER) {
    throw new Error(
      "An active prediction already exists for this company. Publish an article to update it.",
    );
  }
}

export function validateUpdatePredictionInput(raw: unknown, baseDate: string): UpdatePredictionInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid request body");
  }

  const input = raw as Record<string, unknown>;
  const thesisTitle = typeof input.thesisTitle === "string" ? sanitizePredictionThesisTitle(input.thesisTitle) : "";
  const thesis = typeof input.thesis === "string" ? sanitizePredictionThesis(input.thesis) : "";

  validateUpdatedPredictionText(thesisTitle, thesis);

  return {
    thesisTitle,
    thesis,
    timeHorizon: validateTimeHorizonInput(input.timeHorizon, baseDate),
  };
}

export async function createPrediction(input: CreatePredictionInput, user: AuthedUser) {
  return createPredictionForUser(input, user);
}

export async function createPredictionForUser(
  input: CreatePredictionInput,
  user: AuthedUser,
  options: InternalCreatePredictionOptions = {},
) {
  const db = options.db ?? getAdminFirestore();
  const nowIso = new Date().toISOString();
  const instrument = predictionInstrument(input.ticker);
  if (!instrument) throw new Error("Invalid ticker");
  input = { ...input, ticker: instrument.ticker };
  const predictionRef = db.collection("predictions").doc();
  const userRef = db.collection("users").doc(user.uid);
  const watchlistRef = input.watchlistId ? db.collection("watchlists").doc(input.watchlistId) : null;
  let resolvedId = predictionRef.id;
  const postRef = options.post ? db.collection("posts").doc(options.post.id) : null;

  await db.runTransaction(async (tx) => {
    if (postRef && options.post) {
      const previous = await tx.get(postRef);
      if (previous.exists) {
        assertSamePost(previous.data() as Post, options.post.input);
        resolvedId = previous.get("predictionId");
        return;
      }
    }
    const company = await tx.get(db.collection("companies").doc(instrument.companyId));
    if (options.post && !company.exists) throw new Error("Select a company from the directory");
    if (company.get("listingStatus") === "PRIVATE") throw new Error("Invalid ticker: private companies cannot receive stock calls");
    if (instrument.market === "CN_A" && (!company.exists || !["PUBLISHED", "DIRECTORY"].includes(company.get("status")))) throw new Error("Invalid A-share company");
    const [userSnapshot, entryTargetDate, watchlist] = await Promise.all([
      tx.get(userRef),
      resolveEodTargetDateInTransaction(tx, db, input.ticker),
      watchlistRef ? assertWatchlistCanReceivePrediction(tx, watchlistRef, user.uid) : Promise.resolve({ id: "", name: "", isPublic: input.visibility !== "PRIVATE" }),
    ]);
    if (!userSnapshot.exists) {
      throw new Error("User profile not found. Complete bootstrap first.");
    }

    const duplicateKey = [user.uid, input.ticker, input.watchlistId, entryTargetDate].join("__");
    const uniqueRef = db.collection("prediction_uniques").doc(duplicateKey);
    const [uniqueSnapshot, activeTickerPredictions] = await Promise.all([
      tx.get(uniqueRef),
      listActivePredictionsForTickerInTransaction(tx, db, user.uid, input.ticker),
    ]);
    if (postRef && options.post && activeTickerPredictions.length) {
      const primaryIds = userSnapshot.get("publishingPrimaryPredictions") as Record<string, string> | undefined;
      const primary = activeTickerPredictions.find(p => p.id === primaryIds?.[input.ticker]);
      if (primaryIds?.[input.ticker] && !primary) throw new Error("Your primary prediction is no longer active. Select another active prediction or publish without a direction.");
      if (activeTickerPredictions.length !== 1 && !primary) throw new Error("Multiple legacy predictions exist. Select the primary prediction before publishing a directional update.");
      const activeRef = db.collection("predictions").doc((primary ?? activeTickerPredictions[0]).id);
      const active = (await tx.get(activeRef)).data() as Prediction;
      if (active.status === "CLOSING") throw new Error("Your prediction is closing. Wait for settlement or publish without a direction.");
      if (active.direction !== input.direction) throw new Error("Your active prediction has the opposite direction. Open it and explicitly close it before changing your view, or publish without a direction.");
      if (active.visibility !== options.post.input.visibility) throw new Error("Choose the same visibility as your active prediction, or publish without a direction.");
      tx.create(postRef, { ...options.post.input, userId: user.uid, companyId: instrument.companyId, predictionId: activeRef.id, createdAt: nowIso, initial: false } satisfies Post);
      tx.update(userRef, { updatedAt: nowIso });
      resolvedId = activeRef.id;
      return;
    }
    if (uniqueSnapshot.exists) {
      throw new Error("Duplicate prediction exists for the same user, ticker, watchlist, and entry target date.");
    }
    assertTickerActivePredictionLimit(activeTickerPredictions, input.watchlistId);

    const userData = userSnapshot.data() ?? {};
    const timeHorizon = input.timeHorizon
      ? {
          ...input.timeHorizon,
          targetDate: computeTimeHorizonTargetDate(entryTargetDate, input.timeHorizon.value, input.timeHorizon.unit),
        }
      : null;
    await assertOpenUntilAfterLatestEod(input.ticker, timeHorizon);
    if (!watchlist.isPublic && !canUseProFeaturesForUserData(userData as Record<string, unknown>)) {
      throw new Error("Private watchlists are part of Pro. Upgrade to use them.");
    }
    const visibility = watchlist.isPublic ? "PUBLIC" : "PRIVATE";
    const prediction: Prediction = {
      userId: user.uid,
      authorDisplayName:
        (userData.displayName as string | null | undefined) ?? user.displayName ?? null,
      authorPhotoURL: (userData.photoURL as string | null | undefined) ?? user.photoURL ?? null,
      sourceType: options.sourceType ?? "HUMAN",
      watchlistId: watchlist.id,
      watchlistName: watchlist.name,
      ticker: input.ticker,
      direction: input.direction,
      entryRequestedAt: nowIso,
      entryTargetDate,
      entryPrice: null,
      entryPriceSource: null,
      entryDate: null,
      entryTime: null,
      entryCapturedAt: null,
      thesisTitle: sanitizePredictionThesisTitle(input.thesisTitle),
      thesis: sanitizePredictionThesis(input.thesis),
      timeHorizon,
      status: "CREATED",
      visibility,
      commentCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      markPrice: null,
      markPriceSource: null,
      markPriceDate: null,
      markPriceCapturedAt: null,
      markReturnValue: null,
      markScore: null,
      scoreAppliedToUser: null,
      closeRequestedAt: null,
      closeTargetDate: null,
      closedAt: null,
      generation: options.generation ?? null,
      result: null,
    };

    tx.set(predictionRef, prediction);
    if (postRef && options.post) tx.create(postRef, { ...options.post.input, userId: user.uid, companyId: instrument.companyId, predictionId: predictionRef.id, createdAt: nowIso, initial: true } satisfies Post);
    tx.set(uniqueRef, {
      predictionId: predictionRef.id,
      userId: user.uid,
      ticker: input.ticker,
      watchlistId: input.watchlistId,
      direction: input.direction,
      entryTargetDate,
      createdAt: nowIso,
    });

    // If user is still 'user', promote to 'analyst' on first prediction
    if ((userData.role ?? "user") === "user") {
      tx.update(userRef, {
        publishingPrimaryPredictions: { ...(userData.publishingPrimaryPredictions as Record<string, string> ?? {}), [input.ticker]: predictionRef.id },
        updatedAt: nowIso,
        role: "analyst",
        "stats.totalPredictions": FieldValue.increment(1),
        "stats.openingPredictions": FieldValue.increment(1),
      });
    } else {
      tx.update(userRef, {
        publishingPrimaryPredictions: { ...(userData.publishingPrimaryPredictions as Record<string, string> ?? {}), [input.ticker]: predictionRef.id },
        updatedAt: nowIso,
        "stats.totalPredictions": FieldValue.increment(1),
        "stats.openingPredictions": FieldValue.increment(1),
      });
    }
  });

  return { id: resolvedId };
}

export async function closePrediction(predictionId: string, user: AuthedUser) {
  return closePredictionWithReason(predictionId, "", user);
}

export async function closePredictionWithReason(predictionId: string, reason: string, user: AuthedUser) {
  const db = getAdminFirestore();
  const nowIso = new Date().toISOString();
  const predictionRef = db.collection("predictions").doc(predictionId);
  const userRef = db.collection("users").doc(user.uid);
  const resultStatus: PredictionStatus = "CLOSING";
  const trimmedReason = reason.trim();

  if (!trimmedReason) {
    throw new Error("close reason is required");
  }

  await db.runTransaction(async (tx) => {
    const [predictionSnapshot, userSnapshot] = await Promise.all([
      tx.get(predictionRef),
      tx.get(userRef),
    ]);

    if (!predictionSnapshot.exists) {
      throw new Error("Prediction not found");
    }
    if (!userSnapshot.exists) {
      throw new Error("User profile not found. Complete bootstrap first.");
    }

    const prediction = predictionSnapshot.data() as Prediction;
    const closeTargetDate = await resolveEodTargetDateInTransaction(tx, db, prediction.ticker);
    if (prediction.userId !== user.uid) {
      throw new Error("Forbidden");
    }
    const status = canonicalPredictionStatus(prediction.status);
    if (status !== "OPEN") {
      throw new Error("Only OPEN predictions can be closed.");
    }
    if (typeof prediction.entryPrice !== "number" || prediction.entryPrice <= 0) {
      throw new Error("Prediction is missing an entry price.");
    }
    if (!prediction.entryDate) {
      throw new Error("Prediction is missing an entry date.");
    }
    if (closeTargetDate <= prediction.entryDate) {
      throw new Error("Prediction must remain open through at least one completed market day before settlement.");
    }

    tx.update(predictionRef, {
      status: "CLOSING",
      updatedAt: nowIso,
      closeRequestedAt: nowIso,
      closeTargetDate,
      closeReason: trimmedReason,
    });
    tx.update(userRef, {
      updatedAt: nowIso,
      "stats.openPredictions": FieldValue.increment(-1),
      "stats.closingPredictions": FieldValue.increment(1),
    });
  });

  return { closed: false, status: resultStatus };
}

export async function updatePredictionDetails(predictionId: string, input: UpdatePredictionInput, user: AuthedUser) {
  const db = getAdminFirestore();
  const nowIso = new Date().toISOString();
  const predictionRef = db.collection("predictions").doc(predictionId);

  await db.runTransaction(async (tx) => {
    const predictionSnapshot = await tx.get(predictionRef);

    if (!predictionSnapshot.exists) {
      throw new Error("Prediction not found");
    }

    const prediction = predictionSnapshot.data() as Prediction;
    if (prediction.userId !== user.uid) {
      throw new Error("Forbidden");
    }

    const status = canonicalPredictionStatus(prediction.status);
    const canEdit =
      status === "OPEN" ||
      (status === "CREATED" && hasCreateCancelWindowExpired(prediction));

    if (!canEdit) {
      throw new Error("Only OPEN predictions or CREATED predictions after the cancel window can be edited.");
    }

    const baseDate =
      typeof prediction.entryTargetDate === "string" && prediction.entryTargetDate
        ? prediction.entryTargetDate
        : prediction.createdAt.slice(0, 10);
    const timeHorizon = input.timeHorizon
      ? {
          ...input.timeHorizon,
          targetDate: computeTimeHorizonTargetDate(baseDate, input.timeHorizon.value, input.timeHorizon.unit),
        }
      : null;
    await assertOpenUntilAfterLatestEod(prediction.ticker, timeHorizon);

    tx.update(predictionRef, {
      thesisTitle: sanitizePredictionThesisTitle(input.thesisTitle),
      thesis: sanitizePredictionThesis(input.thesis),
      timeHorizon,
      updatedAt: nowIso,
    });
  });

  return { updated: true };
}

export async function cancelPrediction(predictionId: string, user: AuthedUser) {
  const db = getAdminFirestore();
  const nowIso = new Date().toISOString();
  const predictionRef = db.collection("predictions").doc(predictionId);
  const userRef = db.collection("users").doc(user.uid);

  let nextStatus: "CANCELED" | "OPEN" = "CANCELED";

  await db.runTransaction(async (tx) => {
    const [predictionSnapshot, userSnapshot] = await Promise.all([
      tx.get(predictionRef),
      tx.get(userRef),
    ]);

    if (!predictionSnapshot.exists) {
      throw new Error("Prediction not found");
    }
    if (!userSnapshot.exists) {
      throw new Error("User profile not found. Complete bootstrap first.");
    }

    const prediction = predictionSnapshot.data() as Prediction;
    if (prediction.userId !== user.uid) {
      throw new Error("Forbidden");
    }

    const status = canonicalPredictionStatus(prediction.status);

    if (status === "CREATED") {
      if (!hasCancelWindow(prediction.createdAt)) {
        throw new Error("Create cancel window expired.");
      }

      nextStatus = "CANCELED";
      tx.update(predictionRef, {
        status: "CANCELED",
        updatedAt: nowIso,
        canceledAt: nowIso,
      });
      tx.update(userRef, {
        updatedAt: nowIso,
        "stats.totalPredictions": FieldValue.increment(-1),
        "stats.openingPredictions": FieldValue.increment(-1),
        "stats.canceledPredictions": FieldValue.increment(1),
      });
      return;
    }

    if (status === "CLOSING") {
      if (!hasCancelWindow(prediction.closeRequestedAt)) {
        throw new Error("Close cancel window expired.");
      }

      nextStatus = "OPEN";
      tx.update(predictionRef, {
        status: "OPEN",
        updatedAt: nowIso,
        closeRequestedAt: null,
        closeTargetDate: null,
        closeReason: null,
      });
      tx.update(userRef, {
        updatedAt: nowIso,
        "stats.closingPredictions": FieldValue.increment(-1),
        "stats.openPredictions": FieldValue.increment(1),
      });
      return;
    }

    throw new Error("Only CREATED or CLOSING predictions can be canceled.");
  });

  return { status: nextStatus };
}

export async function addComment(predictionId: string, content: string, user: AuthedUser) {
  const db = getAdminFirestore();
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("content is required");
  }
  if (trimmed.length > 2000) {
    throw new Error("content must be <= 2000 chars");
  }

  const nowIso = new Date().toISOString();
  const predictionRef = db.collection("predictions").doc(predictionId);
  const commentRef = predictionRef.collection("comments").doc();
  const userRef = db.collection("users").doc(user.uid);

  await db.runTransaction(async (tx) => {
    const [predictionSnapshot, userSnapshot] = await Promise.all([
      tx.get(predictionRef),
      tx.get(userRef),
    ]);

    if (!predictionSnapshot.exists) {
      throw new Error("Prediction not found");
    }

    if (!userSnapshot.exists) {
      throw new Error("User profile not found. Complete bootstrap first.");
    }

    const userData = userSnapshot.data() ?? {};
    const comment: PredictionComment = {
      predictionId,
      userId: user.uid,
      authorDisplayName:
        (userData.displayName as string | null | undefined) ?? user.displayName ?? null,
      authorPhotoURL: (userData.photoURL as string | null | undefined) ?? user.photoURL ?? null,
      content: trimmed,
      createdAt: nowIso,
      updatedAt: nowIso,
      isDeleted: false,
    };

    tx.set(commentRef, comment);
    tx.update(predictionRef, {
      updatedAt: nowIso,
      commentCount: FieldValue.increment(1),
    });
  });

  return { id: commentRef.id };
}
