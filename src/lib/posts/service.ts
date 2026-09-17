import { getAdminFirestore } from "@/lib/firebase/admin";
import { createPredictionForUser } from "@/lib/predictions/service";
import { predictionInstrument } from "@/lib/predictions/instrument";
import { assertSamePost, postId, type Post, type PostInput } from "./model";

export async function publishPost(input: PostInput, user: { uid: string; displayName?: string | null; photoURL?: string | null }, db = getAdminFirestore()) {
  const id = postId(user.uid, input.requestId);
  if (input.direction) {
    const result = await createPredictionForUser({ ticker: input.ticker, direction: input.direction, watchlistId: "", thesisTitle: input.title, thesis: input.body, visibility: input.visibility }, user, { db, post: { id, input } });
    return { id, predictionId: result.id };
  }
  const ref = db.collection("posts").doc(id);
  const companyId = predictionInstrument(input.ticker)!.companyId;
  await db.runTransaction(async tx => {
    const [previous, company, profile] = await Promise.all([tx.get(ref), tx.get(db.collection("companies").doc(companyId)), tx.get(db.collection("users").doc(user.uid))]);
    if (previous.exists) { assertSamePost(previous.data() as Post, input); return; }
    if (!company.exists) throw new Error("Select a company from the directory");
    if (!profile.exists) throw new Error("User profile not found");
    const now = new Date().toISOString();
    tx.create(ref, { ...input, userId: user.uid, companyId, predictionId: null, createdAt: now, initial: false } satisfies Post);
    tx.update(profile.ref, { updatedAt: now });
  });
  return { id, predictionId: null };
}

async function canReadPost(post: Post, viewerId: string | undefined, db: FirebaseFirestore.Firestore) {
  if (post.userId === viewerId) return true;
  if (post.visibility !== "PUBLIC") return false;
  const profile = await db.collection("users").doc(post.userId).get();
  if (!profile.exists || profile.get("settings.isPublic") === false) return false;
  if (post.predictionId) {
    const prediction = await db.collection("predictions").doc(post.predictionId).get();
    if (!prediction.exists || prediction.get("userId") !== post.userId || prediction.get("visibility") !== "PUBLIC" || prediction.get("status") === "CANCELED") return false;
  }
  return true;
}

export async function readPost(id: string, viewerId?: string, db = getAdminFirestore()) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const snapshot = await db.collection("posts").doc(id).get();
  const post = snapshot.data() as Post | undefined;
  return post && await canReadPost(post, viewerId, db) ? { ...post, id } : null;
}

export async function listPosts(filter: { predictionId?: string; ticker?: string; userId?: string }, viewerId?: string, db = getAdminFirestore()) {
  const [field, value] = filter.predictionId ? ["predictionId", filter.predictionId] : filter.ticker ? ["ticker", predictionInstrument(filter.ticker)?.ticker] : ["userId", filter.userId];
  if (!value) return [];
  // One equality query avoids requiring a composite index for the initial rollout.
  const snapshot = await db.collection("posts").where(field, "==", value).get();
  const rows = await Promise.all(snapshot.docs.map(async doc => {
    const post = doc.data() as Post;
    return await canReadPost(post, viewerId, db) ? { ...post, id: doc.id } : null;
  }));
  return rows.filter(row => row !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
