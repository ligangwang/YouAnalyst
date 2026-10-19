import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "./firebase/admin";
import { postId } from "./posts/model";
import { predictionInstrument } from "./predictions/instrument";
import { parseCompareConfig } from "./compare";
import { sameComparisonSubmission, validCommunityId, validateComparisonComment, validateComparisonSubmission, validateComparisonVote, comparisonVoteTotals, type CommunityComparison, type ComparisonComment, type ComparisonSubmission } from "./compare-community";

type StoredComparison = Omit<CommunityComparison, "id" | "viewerVote"> & { kind: "COMPARISON"; visibility: "PUBLIC" };
const authorName = (data: Record<string, unknown>, fallback?: string | null) => String(data.nickname || data.displayName || fallback || "Community member").slice(0, 100);
const invalid = () => new Error("Comparison not found");

export async function publishComparison(raw: unknown, user: { uid: string; displayName?: string | null }, db = getAdminFirestore()) {
  const input = validateComparisonSubmission(raw);
  const id = postId(user.uid, input.requestId);
  const ref = db.collection("posts").doc(id);
  await db.runTransaction(async tx => {
    const [previous, profile] = await Promise.all([tx.get(ref), tx.get(db.collection("users").doc(user.uid))]);
    if (previous.exists) {
      if (previous.get("kind") !== "COMPARISON" || previous.get("userId") !== user.uid || !sameComparisonSubmission(previous.data() as ComparisonSubmission, input)) throw new Error("This request ID was already used for a different post");
      return;
    }
    if (!profile.exists || profile.get("settings.isPublic") === false) throw new Error("A public profile is required to post to the community");
    tx.create(ref, { ...input, kind: "COMPARISON", userId: user.uid, authorName: authorName(profile.data()!, user.displayName), visibility: "PUBLIC", createdAt: new Date().toISOString(), likes: 0, dislikes: 0, netLikes: 0, commentCount: 0,
      ticker: input.comparison.config.symbols[0], companyId: predictionInstrument(input.comparison.config.symbols[0])!.companyId, direction: null, predictionId: null, initial: false });
  });
  return { id };
}

async function publicComparison(id: string, db: Firestore, tx?: Transaction): Promise<StoredComparison | null> {
  if (!validCommunityId(id)) return null;
  const ref = db.collection("posts").doc(id);
  const snapshot = await (tx ? tx.get(ref) : ref.get());
  if (!snapshot.exists || snapshot.get("kind") !== "COMPARISON" || snapshot.get("visibility") !== "PUBLIC") return null;
  const post = snapshot.data() as StoredComparison;
  const owner = db.collection("users").doc(post.userId);
  const profile = await (tx ? tx.get(owner) : owner.get());
  return profile.exists && profile.get("settings.isPublic") !== false ? post : null;
}

function publicRow(post: StoredComparison, id: string, viewerVote: -1 | 0 | 1 = 0): CommunityComparison {
  return { id, title: post.title, body: post.body, requestId: post.requestId, comparison: post.comparison, userId: post.userId, authorName: post.authorName, createdAt: post.createdAt, likes: post.likes, dislikes: post.dislikes, netLikes: post.netLikes, commentCount: post.commentCount, viewerVote };
}
export async function readCommunityComparison(id: string, viewerId?: string, db = getAdminFirestore()) {
  const post = await publicComparison(id, db);
  if (!post) return null;
  const vote = viewerId ? await db.collection("posts").doc(id).collection("votes").doc(viewerId).get() : null;
  return publicRow(post, id, vote?.get("value") === 1 ? 1 : vote?.get("value") === -1 ? -1 : 0);
}

export async function listCommunityComparisons(cursor?: string | null, viewerId?: string, db = getAdminFirestore()) {
  let query = db.collection("posts").where("kind", "==", "COMPARISON").orderBy("netLikes", "desc").orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) {
    if (cursor.length > 500) throw new Error("Invalid cursor");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { netLikes: number; createdAt: string; id: string };
    if (!Number.isSafeInteger(value.netLikes) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !validCommunityId(value.id)) throw new Error("Invalid cursor");
    query = query.startAfter(value.netLikes, value.createdAt, value.id);
  }
  const snapshot = await query.limit(21).get();
  const page = snapshot.docs.slice(0, 20);
  const items = (await Promise.all(page.map(doc => readCommunityComparison(doc.id, viewerId, db)))).filter((post): post is CommunityComparison => !!post);
  const last = page.at(-1);
  return { items, nextCursor: snapshot.docs.length > 20 && last ? Buffer.from(JSON.stringify({ netLikes: last.get("netLikes"), createdAt: last.get("createdAt"), id: last.id })).toString("base64url") : null };
}

export async function voteOnComparison(id: string, uid: string, value: unknown, db = getAdminFirestore()) {
  const next = validateComparisonVote(value);
  if (!validCommunityId(id)) throw invalid();
  const postRef = db.collection("posts").doc(id), voteRef = postRef.collection("votes").doc(uid);
  return db.runTransaction(async tx => {
    const post = await publicComparison(id, db, tx);
    if (!post) throw invalid();
    const previous = await tx.get(voteRef);
    const old = previous.get("value") === 1 ? 1 : previous.get("value") === -1 ? -1 : 0;
    const totals = comparisonVoteTotals(post.likes, post.dislikes, old, next);
    if (old !== next) {
      tx.set(voteRef, { userId: uid, value: next, updatedAt: new Date().toISOString() });
      tx.update(postRef, totals);
    }
    return { ...totals, viewerVote: next };
  });
}

export async function addComparisonComment(id: string, user: { uid: string; displayName?: string | null }, raw: unknown, db = getAdminFirestore()) {
  const input = validateComparisonComment(raw);
  if (!validCommunityId(id)) throw invalid();
  const ref = db.collection("posts").doc(id), commentRef = ref.collection("comments").doc(postId(user.uid, input.requestId));
  return db.runTransaction(async tx => {
    const post = await publicComparison(id, db, tx);
    if (!post) throw invalid();
    const [previous, profile] = await Promise.all([tx.get(commentRef), tx.get(db.collection("users").doc(user.uid))]);
    if (previous.exists) {
      if (previous.get("content") !== input.content || previous.get("userId") !== user.uid) throw new Error("This request ID was already used for a different comment");
      return { id: commentRef.id, ...previous.data() } as ComparisonComment;
    }
    if (!profile.exists) throw new Error("User profile required");
    const comment: ComparisonComment = { id: commentRef.id, userId: user.uid, authorName: authorName(profile.data()!, user.displayName), content: input.content, createdAt: new Date().toISOString() };
    tx.create(commentRef, comment); tx.update(ref, { commentCount: post.commentCount + 1 });
    return comment;
  });
}

export async function listComparisonComments(id: string, cursor?: string | null, db = getAdminFirestore()) {
  if (!await publicComparison(id, db)) throw invalid();
  let query = db.collection("posts").doc(id).collection("comments").orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) {
    if (cursor.length > 400) throw new Error("Invalid cursor");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { createdAt: string; id: string };
    if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !validCommunityId(value.id)) throw new Error("Invalid cursor");
    query = query.startAfter(value.createdAt, value.id);
  }
  const snapshot = await query.limit(21).get();
  const page = snapshot.docs.slice(0, 20), last = page.at(-1);
  return { items: page.map(doc => ({ ...doc.data(), id: doc.id }) as ComparisonComment), nextCursor: snapshot.docs.length > 20 && last ? Buffer.from(JSON.stringify({ createdAt: last.get("createdAt"), id: last.id })).toString("base64url") : null };
}

let featuredCache: { expires: number; promise: Promise<CommunityComparison | null> } | null = null;
export async function featuredCommunityComparison(): Promise<CommunityComparison | null> {
  if (!featuredCache || featuredCache.expires < Date.now()) {
    const promise = (async () => {
      let cursor: string | null = null;
      // Bound reads even if authors have made many previously public posts private.
      for (let page = 0; page < 5; page++) {
        const result = await listCommunityComparisons(cursor);
        if (result.items[0]) return result.items[0];
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return null;
    })().catch(() => null);
    featuredCache = { expires: Date.now() + 30000, promise };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([featuredCache.promise, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500); })]); }
  finally { clearTimeout(timer); }
}

export async function resolveCompareLanding(params: URLSearchParams, getFeatured = featuredCommunityComparison) {
  const explicit = ["symbols", "start", "end", "style", "colors"].some(key => params.has(key));
  const featured = explicit ? null : await getFeatured().catch(() => null);
  return { config: featured?.comparison.config ?? parseCompareConfig(params), featured };
}
