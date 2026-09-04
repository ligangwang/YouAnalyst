import { getAdminFirestore } from "@/lib/firebase/admin";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { NextRequest, NextResponse } from "next/server";
import { canonicalPredictionStatus, normalizeTicker, sanitizePredictionThesis, sanitizePredictionThesisTitle, type Prediction } from "@/lib/predictions/types";

const PUBLIC_PREDICTION_STATUSES = ["CREATED", "OPEN", "SETTLED", "OPENING", "CLOSING", "CLOSED"] as const;

function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? "25");
  if (!Number.isFinite(parsed)) {
    return 25;
  }

  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

function parseCursor(raw: string | null): string | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isMissingIndexError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code =
    typeof error === "object" && error && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  return (
    code === 9 ||
    /requires an index|failed precondition|query requires an index/i.test(error.message)
  );
}

function mapPredictionDoc(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() as Prediction;

  return {
    id: doc.id,
    ...data,
    status: canonicalPredictionStatus(data.status) ?? "CREATED",
    thesisTitle: sanitizePredictionThesisTitle(data.thesisTitle),
    thesis: sanitizePredictionThesis(data.thesis),
  };
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

async function listTickerPredictions(
  db: FirebaseFirestore.Firestore,
  ticker: string,
  limit: number,
  cursorCreatedAt?: string,
) {
  try {
    let query = db
      .collection("predictions")
      .where("ticker", "==", ticker)
      .where("visibility", "==", "PUBLIC")
      .orderBy("createdAt", "desc")
      .limit(limit + 1);

    if (cursorCreatedAt) {
      query = query.startAfter(cursorCreatedAt);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs;
    const hasMore = docs.length > limit;
    const selected = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore && selected.length > 0 ? selected[selected.length - 1].get("createdAt") : null;

    return {
      items: selected
        .filter((doc) => PUBLIC_PREDICTION_STATUSES.includes(doc.get("status") as (typeof PUBLIC_PREDICTION_STATUSES)[number]))
        .map(mapPredictionDoc),
      nextCursor: typeof nextCursor === "string" ? nextCursor : null,
    };
  } catch (error) {
    if (!isMissingIndexError(error)) {
      throw error;
    }

    const items: ReturnType<typeof mapPredictionDoc>[] = [];
    let nextCursor: string | null = null;
    const batchSize = Math.max(limit, 50);
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

    while (items.length < limit + 1) {
      let query = db.collection("predictions").orderBy("createdAt", "desc").limit(batchSize);

      if (cursor) {
        query = query.startAfter(cursor);
      } else if (cursorCreatedAt) {
        query = query.startAfter(cursorCreatedAt);
      }

      const snapshot = await query.get();
      if (snapshot.empty) {
        break;
      }

      for (const doc of snapshot.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (
          data.ticker === ticker &&
          data.visibility === "PUBLIC" &&
          typeof data.status === "string" &&
          (PUBLIC_PREDICTION_STATUSES as readonly string[]).includes(data.status)
        ) {
          items.push(mapPredictionDoc(doc));
        }

        if (items.length >= limit + 1) {
          break;
        }
      }

      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < batchSize) {
        break;
      }
    }

    if (items.length > limit) {
      const nextItem = items[limit - 1];
      nextCursor = typeof nextItem.createdAt === "string" ? nextItem.createdAt : null;
    }

    return {
      items: items.slice(0, limit),
      nextCursor,
    };
  }
}

async function applyAuthorInfo(
  db: FirebaseFirestore.Firestore,
  items: Array<ReturnType<typeof mapPredictionDoc>>,
) {
  const userIds = Array.from(new Set(items.map((item) => item.userId).filter(Boolean)));
  if (userIds.length === 0) {
    return items;
  }

  const authorEntries = await Promise.all(
    userIds.map(async (userId) => {
      const userSnapshot = await db.collection("users").doc(userId).get();
      const userData = userSnapshot.data() as Record<string, unknown> | undefined;
      const rawNickname = typeof userData?.nickname === "string" ? userData.nickname.trim() : "";
      const stats = userData?.stats && typeof userData.stats === "object"
        ? userData.stats as Record<string, unknown>
        : {};
      const canShowStats = isPublicProfile(userData);
      return [userId, {
        nickname: rawNickname || null,
        level: canShowStats ? numberFromStats(stats, "level") || 1 : null,
        totalPredictions: canShowStats ? numberFromStats(stats, "settledCalls") || numberFromStats(stats, "closedPredictions") : null,
      }] as const;
    }),
  );
  const authorByUserId = new Map(authorEntries);

  return items.map((item) => ({
    ...item,
    authorNickname: authorByUserId.get(item.userId)?.nickname ?? null,
    authorStats:
      authorByUserId.get(item.userId)?.level === null ||
      authorByUserId.get(item.userId)?.totalPredictions === null
        ? null
        : {
            level: authorByUserId.get(item.userId)?.level ?? 1,
            totalPredictions: authorByUserId.get(item.userId)?.totalPredictions ?? 0,
          },
  }));
}

async function readViewerPosition(
  db: FirebaseFirestore.Firestore,
  userId: string | undefined,
  ticker: string,
) {
  if (!userId) {
    return null;
  }

  const snapshot = await db.collection("predictions")
    .where("userId", "==", userId)
    .where("ticker", "==", ticker)
    .get();
  const doc = snapshot.docs
    .filter((candidate) => candidate.get("visibility") === "PUBLIC")
    .find((candidate) => {
      const status = canonicalPredictionStatus(candidate.get("status"));
      return status === "CREATED" || status === "OPEN" || status === "CLOSING";
    });
  if (!doc) {
    return null;
  }

  const [position] = await applyAuthorInfo(db, [mapPredictionDoc(doc)]);
  return position ?? null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const normalizedTicker = normalizeTicker(symbol);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const cursorCreatedAt = parseCursor(request.nextUrl.searchParams.get("cursorCreatedAt"));
  const db = getAdminFirestore();

  try {
    const decoded = await getDecodedUserFromRequest(request);
    const [result, viewerPosition] = await Promise.all([
      listTickerPredictions(db, normalizedTicker, limit, cursorCreatedAt),
      readViewerPosition(db, decoded?.uid, normalizedTicker),
    ]);
    const itemsWithPreferredNames = await applyAuthorInfo(db, result.items);

    return NextResponse.json({
      items: itemsWithPreferredNames,
      viewerPosition,
      nextCursor: result.nextCursor,
      ticker: normalizedTicker,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch ticker predictions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
