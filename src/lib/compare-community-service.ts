import { FieldPath, type Firestore, type Transaction, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "./firebase/admin";
import { postId } from "./posts/model";
import { predictionInstrument } from "./predictions/instrument";
import { parseCompareConfig } from "./compare";
import { sameComparisonSubmission, validCommunityId, validateComparisonComment, validateComparisonSubmission, validateComparisonVote, comparisonVoteTotals, type CommunityComparison, type CommunityComparisonPage, type InitialCommunityComparisonPage, type ComparisonComment, type ComparisonSubmission } from "./compare-community";

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
  return publicComparisonSnapshot(snapshot, db, tx);
}

async function publicComparisonSnapshot(snapshot: DocumentSnapshot, db: Firestore, tx?: Transaction): Promise<StoredComparison | null> {
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

export async function listCommunityComparisons(cursor?: string | null, viewerId?: string, db = getAdminFirestore()): Promise<CommunityComparisonPage> {
  let query = db.collection("posts").where("kind", "==", "COMPARISON").orderBy("netLikes", "desc").orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) {
    if (cursor.length > 500) throw new Error("Invalid cursor");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { netLikes: number; createdAt: string; id: string };
    if (!Number.isSafeInteger(value.netLikes) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !validCommunityId(value.id)) throw new Error("Invalid cursor");
    query = query.startAfter(value.netLikes, value.createdAt, value.id);
  }
  const snapshot = await query.limit(21).get();
  const page = snapshot.docs.slice(0, 20);
  // The query already contains each post. Reuse that snapshot, while checking
  // current author privacy and viewer votes on every list request.
  const items = (await Promise.all(page.map(async doc => {
    if (!validCommunityId(doc.id)) return null;
    const post = await publicComparisonSnapshot(doc, db);
    if (!post) return null;
    const vote = viewerId ? await doc.ref.collection("votes").doc(viewerId).get() : null;
    return publicRow(post, doc.id, vote?.get("value") === 1 ? 1 : vote?.get("value") === -1 ? -1 : 0);
  }))).filter((post): post is CommunityComparison => !!post);
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

export async function withCommunityViewerVotes(page: InitialCommunityComparisonPage, viewerId: string,
  db = getAdminFirestore()): Promise<InitialCommunityComparisonPage> {
  const posts = db.collection("posts");
  const refs = page.items.map(post => posts.doc(post.id).collection("votes").doc(viewerId));
  const votes = refs.length ? await db.getAll(...refs) : [];
  return {
    ...page,
    viewerId,
    items: page.items.map((post, index) => {
      const value = votes[index]?.get("value");
      return { ...post, viewerVote: value === 1 || value === -1 ? value : 0 };
    }),
  };
}

type CommunityLanding = { featured: CommunityComparison | null; initialPage?: InitialCommunityComparisonPage };

export function createFeaturedCommunityLoader(list = listCommunityComparisons) {
  let cached: { expiresAt: number; featured: Promise<CommunityComparison | null> } | undefined;
  return async (): Promise<CommunityLanding> => {
    let loading: Promise<CommunityLanding>;
    if (cached && cached.expiresAt >= Date.now()) {
      loading = cached.featured.then(featured => ({ featured }));
    } else {
      const expiresAt = Date.now() + 30_000;
      loading = (async () => {
        const initialPage = { ...await list(), expiresAt };
        let page = initialPage;
        // Bound reads when previously public posts are now private.
        for (let remaining = 4; !page.items.length && page.nextCursor && remaining > 0; remaining--) {
          page = { ...await list(page.nextCursor), expiresAt };
        }
        return { featured: page.items[0] ?? null, initialPage };
      })().catch(() => ({ featured: null }));
      // Only the page that starts the read may reuse the privacy-checked list.
      // Subsequent visitors still check current privacy in the list API.
      cached = { expiresAt, featured: loading.then(result => result.featured) };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([loading, new Promise<CommunityLanding>(resolve => {
        timer = setTimeout(() => resolve({ featured: null }), 1500);
      })]);
    } finally {
      clearTimeout(timer);
    }
  };
}

const loadFeaturedCommunity = createFeaturedCommunityLoader();

export async function resolveCompareLanding(params: URLSearchParams, getFeatured = loadFeaturedCommunity) {
  const explicit = ["symbols", "start", "end", "style", "colors"].some(key => params.has(key));
  const landing: CommunityLanding = explicit ? { featured: null } : await getFeatured().catch(() => ({ featured: null }));
  return { ...landing, config: landing.featured?.comparison.config ?? parseCompareConfig(params) };
}
