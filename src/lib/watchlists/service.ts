import { FieldValue } from "firebase-admin/firestore";
import { areProFeaturesEnabled, canUseProFeaturesForUserData } from "@/lib/features";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  canonicalPredictionStatus,
  type PredictionStatus,
  sanitizePredictionThesis,
  sanitizePredictionThesisTitle,
  type Prediction,
  type PredictionVisibility,
} from "@/lib/predictions/types";

export const MAX_WATCHLISTS_PER_USER = 5;
export const MAX_WATCHLIST_NAME_LENGTH = 80;
export const MAX_WATCHLIST_DESCRIPTION_LENGTH = 500;
export const WATCHLIST_PREVIEW_LIMIT = 3;

const LIVE_STATUSES = new Set(["CREATED", "OPEN", "CLOSING"]);
const SETTLED_STATUSES = new Set(["SETTLED"]);
const ACTIVE_PREDICTION_STATUSES = ["CREATED", "OPEN", "OPENING", "CLOSING"] as const;
const MAX_ACTIVE_PREDICTIONS_PER_TICKER = 2;

type AuthedUser = {
  uid: string;
};

export type Watchlist = {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type WatchlistMetrics = {
  liveReturn: number | null;
  settledReturn: number | null;
  totalReturn: number | null;
  totalPredictionCount: number;
  livePredictionCount: number;
  settledPredictionCount: number;
  winRate: number | null;
};

export type WatchlistSummary = Watchlist & {
  metrics: WatchlistMetrics;
};

export type PublicWatchlistSummary = WatchlistSummary & {
  owner: {
    id: string;
    displayName: string | null;
    nickname: string | null;
    photoURL: string | null;
  };
  previewPredictions: WatchlistPrediction[];
};

export type WatchlistPrediction = Prediction & {
  id: string;
};

export type WatchlistDetail = WatchlistSummary & {
  viewerAccess: "preview" | "full";
  owner: {
    id: string;
    displayName: string | null;
    nickname: string | null;
    photoURL: string | null;
    stats: {
      totalScore: number;
      level: number;
      followersCount: number;
      settledCalls: number;
      winRate: number | null;
    };
  };
  livePredictions: WatchlistPrediction[];
  settledPredictions: WatchlistPrediction[];
};

export type CreateWatchlistInput = {
  name: string;
  description?: string | null;
  isPublic?: boolean;
};

export type UpdateWatchlistInput = CreateWatchlistInput;

export type BackfillWatchlistsInput = {
  dryRun?: boolean;
  limit?: number;
  defaultName?: string;
};

export type BackfillWatchlistsResult = {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  usersTouched: number;
  hasMore: boolean;
  defaultName: string;
};

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapWatchlistDoc(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): Watchlist {
  const data = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    userId: trimString(data.userId),
    name: trimString(data.name),
    description: trimString(data.description) || null,
    isPublic: data.isPublic !== false,
    createdAt: trimString(data.createdAt),
    updatedAt: trimString(data.updatedAt),
    archivedAt: trimString(data.archivedAt) || null,
  };
}

function mapPredictionDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): WatchlistPrediction | null {
  const data = doc.data() as Prediction;
  const status = canonicalPredictionStatus(data.status);
  if (!status || status === "CANCELED") {
    return null;
  }

  return {
    id: doc.id,
    ...data,
    status,
    thesisTitle: sanitizePredictionThesisTitle(data.thesisTitle),
    thesis: sanitizePredictionThesis(data.thesis),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function metricsForPredictions(predictions: WatchlistPrediction[]): WatchlistMetrics {
  const livePredictions = predictions.filter((prediction) => LIVE_STATUSES.has(prediction.status));
  const settledPredictions = predictions.filter((prediction) => SETTLED_STATUSES.has(prediction.status));
  const liveReturns = livePredictions
    .map((prediction) => prediction.markReturnValue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const settledReturns = settledPredictions
    .map((prediction) => prediction.result?.returnValue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const settledOutcomes = settledPredictions
    .map((prediction) => prediction.result?.outcome)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const wins = settledOutcomes.filter((outcome) => outcome > 0).length;

  return {
    liveReturn: average(liveReturns),
    settledReturn: average(settledReturns),
    totalReturn: average([...liveReturns, ...settledReturns]),
    totalPredictionCount: livePredictions.length + settledPredictions.length,
    livePredictionCount: livePredictions.length,
    settledPredictionCount: settledPredictions.length,
    winRate: settledOutcomes.length > 0 ? wins / settledOutcomes.length : null,
  };
}

function numberFromStats(stats: Record<string, unknown>, key: string): number {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumberFromStats(stats: Record<string, unknown>, key: string): number | null {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapWatchlistOwner(
  userId: string,
  data: Record<string, unknown> | undefined,
): WatchlistDetail["owner"] {
  const stats = data?.stats && typeof data.stats === "object" ? data.stats as Record<string, unknown> : {};

  return {
    id: userId,
    displayName: typeof data?.displayName === "string" ? data.displayName : null,
    nickname: typeof data?.nickname === "string" ? data.nickname : null,
    photoURL: typeof data?.photoURL === "string" ? data.photoURL : null,
    stats: {
      totalScore: numberFromStats(stats, "totalScore"),
      level: Math.max(1, numberFromStats(stats, "level") || 1),
      followersCount: numberFromStats(stats, "followersCount"),
      settledCalls: numberFromStats(stats, "settledCalls") || numberFromStats(stats, "closedPredictions"),
      winRate: nullableNumberFromStats(stats, "winRate"),
    },
  };
}

function watchlistPerformanceValue(metrics: WatchlistMetrics): number | null {
  if (typeof metrics.settledReturn === "number" && Number.isFinite(metrics.settledReturn)) {
    return metrics.settledReturn;
  }

  if (typeof metrics.liveReturn === "number" && Number.isFinite(metrics.liveReturn)) {
    return metrics.liveReturn;
  }

  return null;
}

function predictionVisibilityForWatchlist(watchlist: Pick<Watchlist, "isPublic">): PredictionVisibility {
  return watchlist.isPublic ? "PUBLIC" : "PRIVATE";
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
      if (!status || !ACTIVE_PREDICTION_STATUSES.includes(status as (typeof ACTIVE_PREDICTION_STATUSES)[number]) || !watchlistId) {
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

  const distinctWatchlistCount = new Set(relevantPredictions.map((prediction) => prediction.watchlistId)).size;
  if (distinctWatchlistCount >= MAX_ACTIVE_PREDICTIONS_PER_TICKER) {
    throw new Error(
      `Active prediction limit reached for this ticker. You can track the same ticker in up to ${MAX_ACTIVE_PREDICTIONS_PER_TICKER} distinct watchlists at a time.`,
    );
  }
}

async function listWatchlistPredictions(
  watchlistId: string,
  options: { includePrivate?: boolean } = {},
): Promise<WatchlistPrediction[]> {
  let query = getAdminFirestore()
    .collection("predictions")
    .where("watchlistId", "==", watchlistId) as FirebaseFirestore.Query;

  if (options.includePrivate !== true) {
    query = query.where("visibility", "==", "PUBLIC");
  }

  const snapshot = await query.get();

  return snapshot.docs
    .map(mapPredictionDoc)
    .filter((prediction): prediction is WatchlistPrediction => prediction !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function validateCreateWatchlistInput(raw: unknown): CreateWatchlistInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid request body");
  }

  const input = raw as Record<string, unknown>;
  const name = trimString(input.name);
  const description = trimString(input.description);
  const isPublic = input.isPublic;

  if (!name) {
    throw new Error("watchlist name is required");
  }

  if (name.length > MAX_WATCHLIST_NAME_LENGTH) {
    throw new Error(`watchlist name must be <= ${MAX_WATCHLIST_NAME_LENGTH} chars`);
  }

  if (description.length > MAX_WATCHLIST_DESCRIPTION_LENGTH) {
    throw new Error(`watchlist description must be <= ${MAX_WATCHLIST_DESCRIPTION_LENGTH} chars`);
  }

  if (isPublic !== undefined && typeof isPublic !== "boolean") {
    throw new Error("watchlist visibility must be true or false");
  }

  return {
    name,
    description: description || null,
    isPublic: isPublic === false ? false : true,
  };
}

export const validateUpdateWatchlistInput = validateCreateWatchlistInput;

export async function listWatchlistsForUser(
  userId: string,
  options: { includePrivate?: boolean } = {},
): Promise<WatchlistSummary[]> {
  const db = getAdminFirestore();
  const snapshot = await db.collection("watchlists").where("userId", "==", userId).get();
  const watchlists = snapshot.docs
    .map(mapWatchlistDoc)
    .filter((watchlist) => !watchlist.archivedAt)
    .filter((watchlist) => options.includePrivate === true || watchlist.isPublic)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const summaries = await Promise.all(
    watchlists.map(async (watchlist) => {
      const predictions = await listWatchlistPredictions(watchlist.id, { includePrivate: options.includePrivate });
      return {
        ...watchlist,
        metrics: metricsForPredictions(predictions),
      };
    }),
  );

  return summaries;
}

export async function listPublicWatchlists(limit = 24): Promise<PublicWatchlistSummary[]> {
  const db = getAdminFirestore();
  const clampedLimit = Math.max(1, Math.min(limit, 48));
  const candidateLimit = Math.min(Math.max(clampedLimit * 5, 120), 240);
  const snapshot = await db.collection("watchlists").orderBy("createdAt", "desc").limit(candidateLimit).get();
  const watchlists = snapshot.docs
    .map(mapWatchlistDoc)
    .filter((watchlist) => !watchlist.archivedAt && watchlist.isPublic);

  const ownerIds = Array.from(new Set(watchlists.map((watchlist) => watchlist.userId).filter(Boolean)));
  const ownerEntries = await Promise.all(
    ownerIds.map(async (userId) => {
      const userSnapshot = await db.collection("users").doc(userId).get();
      const data = userSnapshot.data() as Record<string, unknown> | undefined;
      const settings = data?.settings;
      const isPublic = !settings || typeof settings !== "object"
        ? true
        : (settings as Record<string, unknown>).isPublic !== false;

      return [userId, isPublic ? {
        id: userId,
        displayName: typeof data?.displayName === "string" ? data.displayName : null,
        nickname: typeof data?.nickname === "string" ? data.nickname : null,
        photoURL: typeof data?.photoURL === "string" ? data.photoURL : null,
      } : null] as const;
    }),
  );
  const ownerById = new Map(ownerEntries);

  const summaries = await Promise.all(
    watchlists.map(async (watchlist) => {
      const owner = ownerById.get(watchlist.userId);
      if (!owner) {
        return null;
      }

      const predictions = await listWatchlistPredictions(watchlist.id);
      return {
        ...watchlist,
        metrics: metricsForPredictions(predictions),
        owner,
        previewPredictions: predictions.slice(0, WATCHLIST_PREVIEW_LIMIT),
      };
    }),
  );

  return summaries
    .filter((summary): summary is PublicWatchlistSummary => summary !== null)
    .sort((a, b) => {
      const aPerformance = watchlistPerformanceValue(a.metrics);
      const bPerformance = watchlistPerformanceValue(b.metrics);

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
    })
    .slice(0, clampedLimit);
}

export async function createWatchlist(input: CreateWatchlistInput, user: AuthedUser): Promise<{ id: string }> {
  const db = getAdminFirestore();
  const nowIso = new Date().toISOString();
  const userRef = db.collection("users").doc(user.uid);
  const watchlistRef = db.collection("watchlists").doc();
  const isPublic = input.isPublic !== false;

  if (!isPublic && !areProFeaturesEnabled()) {
    throw new Error("Private watchlists are not enabled.");
  }

  await db.runTransaction(async (tx) => {
    const [userSnapshot, existingSnapshot] = await Promise.all([
      tx.get(userRef),
      tx.get(db.collection("watchlists").where("userId", "==", user.uid)),
    ]);

    if (!userSnapshot.exists) {
      throw new Error("User profile not found. Complete bootstrap first.");
    }

    const userData = userSnapshot.data() as Record<string, unknown> | undefined;
    if (!isPublic && !canUseProFeaturesForUserData(userData)) {
      throw new Error("Private watchlists are part of Pro. Upgrade to create one.");
    }

    const activeCount = existingSnapshot.docs.filter((doc) => !trimString(doc.get("archivedAt"))).length;
    if (activeCount >= MAX_WATCHLISTS_PER_USER) {
      throw new Error(`watchlist limit reached. You can create up to ${MAX_WATCHLISTS_PER_USER} watchlists.`);
    }

    tx.set(watchlistRef, {
      userId: user.uid,
      name: input.name,
      description: input.description ?? null,
      isPublic,
      createdAt: nowIso,
      updatedAt: nowIso,
      archivedAt: null,
    });
    tx.update(userRef, {
      updatedAt: nowIso,
      "stats.watchlistCount": FieldValue.increment(1),
    });
  });

  return { id: watchlistRef.id };
}

export async function updateWatchlist(
  watchlistId: string,
  input: UpdateWatchlistInput,
  user: AuthedUser,
): Promise<{ updated: true }> {
  const db = getAdminFirestore();
  const nowIso = new Date().toISOString();
  const watchlistRef = db.collection("watchlists").doc(watchlistId);
  const isPublic = input.isPublic !== false;

  if (!isPublic && !areProFeaturesEnabled()) {
    throw new Error("Private watchlists are not enabled.");
  }

  await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(user.uid);
    const [watchlistSnapshot, userSnapshot] = await Promise.all([
      tx.get(watchlistRef),
      tx.get(userRef),
    ]);
    if (!watchlistSnapshot.exists) {
      throw new Error("Watchlist not found");
    }
    if (!userSnapshot.exists) {
      throw new Error("User profile not found. Complete bootstrap first.");
    }

    const watchlist = mapWatchlistDoc(watchlistSnapshot);
    if (watchlist.userId !== user.uid) {
      throw new Error("Forbidden");
    }

    if (watchlist.archivedAt) {
      throw new Error("Watchlist not found");
    }

    if (watchlist.isPublic && !isPublic) {
      throw new Error("Public watchlists cannot be made private. Close any predictions you no longer want to continue publicly and use a private watchlist for new ideas.");
    }

    const userData = userSnapshot.data() as Record<string, unknown> | undefined;
    if (!isPublic && !canUseProFeaturesForUserData(userData)) {
      throw new Error("Private watchlists are part of Pro. Upgrade to use them.");
    }

    tx.update(watchlistRef, {
      name: input.name,
      description: input.description ?? null,
      isPublic,
      updatedAt: nowIso,
    });
  });

  const predictionSnapshot = await db.collection("predictions").where("watchlistId", "==", watchlistId).get();
  const visibility = isPublic ? "PUBLIC" : "PRIVATE";
  let batch = db.batch();
  let batchSize = 0;
  for (const doc of predictionSnapshot.docs) {
    batch.update(doc.ref, {
      watchlistName: input.name,
      visibility,
      updatedAt: nowIso,
    });
    batchSize += 1;
    if (batchSize === 450) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }
  if (batchSize > 0) {
    await batch.commit();
  }

  return { updated: true };
}

export async function assertWatchlistCanReceivePrediction(
  tx: FirebaseFirestore.Transaction,
  watchlistRef: FirebaseFirestore.DocumentReference,
  userId: string,
): Promise<Watchlist> {
  const snapshot = await tx.get(watchlistRef);
  if (!snapshot.exists) {
    throw new Error("watchlist is required");
  }

  const watchlist = mapWatchlistDoc(snapshot);
  if (watchlist.userId !== userId) {
    throw new Error("watchlist must belong to the prediction author");
  }

  if (watchlist.archivedAt) {
    throw new Error("watchlist is archived");
  }

  return watchlist;
}

export async function getOrCreateDefaultWatchlistForUser(
  userId: string,
  name = "Main Watchlist",
): Promise<string> {
  const existing = await listWatchlistsForUser(userId, { includePrivate: true });
  if (existing[0]) {
    return existing[0].id;
  }

  const created = await createWatchlist({ name, description: null }, { uid: userId });
  return created.id;
}

export async function getOrCreatePublicWatchlistForUser(
  userId: string,
  name = "Tracked Positions",
): Promise<string> {
  const existing = await listWatchlistsForUser(userId, { includePrivate: true });
  const publicWatchlist = existing.find((watchlist) => watchlist.isPublic && !watchlist.archivedAt);
  if (publicWatchlist) {
    return publicWatchlist.id;
  }

  const created = await createWatchlist({ name, description: "Positions opened from company pages.", isPublic: true }, { uid: userId });
  return created.id;
}

async function findRawWatchlistForBackfill(userId: string, defaultName: string): Promise<Watchlist | null> {
  const snapshot = await getAdminFirestore().collection("watchlists").where("userId", "==", userId).get();
  const active = snapshot.docs
    .map(mapWatchlistDoc)
    .filter((watchlist) => !watchlist.archivedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return active.find((watchlist) => watchlist.name === defaultName) ?? active[0] ?? null;
}

export async function movePredictionToWatchlist(
  predictionId: string,
  watchlistId: string,
  user: AuthedUser,
): Promise<{ moved: true; watchlistId: string; watchlistName: string }> {
  const db = getAdminFirestore();
  const nowIso = new Date().toISOString();
  const predictionRef = db.collection("predictions").doc(predictionId);
  const watchlistRef = db.collection("watchlists").doc(watchlistId);
  let movedWatchlistId = "";
  let movedWatchlistName = "";

  await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(user.uid);
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
    if (!status || status === "CANCELED") {
      throw new Error("Prediction not found");
    }

    const watchlist = await assertWatchlistCanReceivePrediction(tx, watchlistRef, user.uid);
    const userData = userSnapshot.data() as Record<string, unknown> | undefined;
    if (!watchlist.isPublic && !canUseProFeaturesForUserData(userData)) {
      throw new Error("Private watchlists are part of Pro. Upgrade to use them.");
    }
    if (prediction.visibility === "PUBLIC" && !watchlist.isPublic) {
      throw new Error("Public predictions cannot be moved into private watchlists. Close the prediction if you no longer want to continue it publicly.");
    }
    if (ACTIVE_PREDICTION_STATUSES.includes(status as (typeof ACTIVE_PREDICTION_STATUSES)[number])) {
      const activePredictions = await listActivePredictionsForTickerInTransaction(tx, db, user.uid, prediction.ticker);
      assertTickerActivePredictionLimit(activePredictions, watchlist.id, { excludePredictionId: predictionId });
    }
    movedWatchlistId = watchlist.id;
    movedWatchlistName = watchlist.name;
    tx.update(predictionRef, {
      watchlistId: watchlist.id,
      watchlistName: watchlist.name,
      visibility: predictionVisibilityForWatchlist(watchlist),
      updatedAt: nowIso,
    });
  });

  if (!movedWatchlistId) {
    throw new Error("Watchlist not found");
  }

  return {
    moved: true,
    watchlistId: movedWatchlistId,
    watchlistName: movedWatchlistName,
  };
}

export async function backfillLegacyPredictionWatchlists(
  input: BackfillWatchlistsInput = {},
): Promise<BackfillWatchlistsResult> {
  const db = getAdminFirestore();
  const dryRun = input.dryRun === true;
  const parsedLimit = Number(input.limit ?? 500);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(Math.trunc(parsedLimit), 1000))
    : 500;
  const defaultName = trimString(input.defaultName) || "Main Watchlist";
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let scanned = 0;
  let hasMore = false;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (docs.length < limit) {
    let query = db.collection("predictions").orderBy("createdAt", "desc").limit(500);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    scanned += snapshot.docs.length;
    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    for (const doc of snapshot.docs) {
      if (!trimString(doc.get("watchlistId"))) {
        docs.push(doc);
        if (docs.length === limit) {
          break;
        }
      }
    }

    lastDoc = snapshot.docs.at(-1) ?? null;
    hasMore = snapshot.docs.length === 500;
    if (!hasMore) {
      break;
    }
  }
  const nowIso = new Date().toISOString();
  const watchlistByUserId = new Map<string, Watchlist>();
  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const prediction = doc.data() as Prediction;
    const userId = trimString(prediction.userId);
    const status = canonicalPredictionStatus(prediction.status);
    if (!userId || !status || status === "CANCELED") {
      skipped += 1;
      continue;
    }

    let watchlist = watchlistByUserId.get(userId);
    if (!watchlist) {
      const existing = await findRawWatchlistForBackfill(userId, defaultName);
      if (existing) {
        watchlist = existing;
      } else if (dryRun) {
        watchlist = {
          id: `dry_run_default_${userId}`,
          userId,
          name: defaultName,
          description: null,
          isPublic: true,
          createdAt: nowIso,
          updatedAt: nowIso,
          archivedAt: null,
        };
      } else {
        const created = await createWatchlist({ name: defaultName, description: null }, { uid: userId });
        const createdSnapshot = await db.collection("watchlists").doc(created.id).get();
        watchlist = mapWatchlistDoc(createdSnapshot);
      }
      watchlistByUserId.set(userId, watchlist);
    }

    if (!dryRun) {
      await doc.ref.update({
        watchlistId: watchlist.id,
        watchlistName: watchlist.name,
        visibility: predictionVisibilityForWatchlist(watchlist),
        updatedAt: nowIso,
      });
    }
    updated += 1;
  }

  return {
    dryRun,
    scanned,
    updated,
    skipped,
    usersTouched: watchlistByUserId.size,
    hasMore,
    defaultName,
  };
}

export async function getWatchlistDetail(
  watchlistId: string,
  options: { viewerUserId?: string | null } = {},
): Promise<WatchlistDetail | null> {
  const db = getAdminFirestore();
  const snapshot = await db.collection("watchlists").doc(watchlistId).get();
  if (!snapshot.exists) {
    return null;
  }

  const watchlist = mapWatchlistDoc(snapshot);
  if (watchlist.archivedAt) {
    return null;
  }

  const isOwner = Boolean(options.viewerUserId && options.viewerUserId === watchlist.userId);
  if (!watchlist.isPublic && !isOwner) {
    return null;
  }

  const ownerSnapshot = await db.collection("users").doc(watchlist.userId).get();
  const owner = mapWatchlistOwner(watchlist.userId, ownerSnapshot.data() as Record<string, unknown> | undefined);
  const predictions = await listWatchlistPredictions(watchlist.id, { includePrivate: isOwner });
  const metrics = metricsForPredictions(predictions);
  const viewerAccess = options.viewerUserId || !watchlist.isPublic ? "full" : "preview";
  const visiblePredictions = viewerAccess === "preview"
    ? predictions.slice(0, WATCHLIST_PREVIEW_LIMIT)
    : predictions;

  return {
    ...watchlist,
    metrics,
    viewerAccess,
    owner,
    livePredictions: visiblePredictions.filter((prediction) => LIVE_STATUSES.has(prediction.status)),
    settledPredictions: visiblePredictions.filter((prediction) => SETTLED_STATUSES.has(prediction.status)),
  };
}
