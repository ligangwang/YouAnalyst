import { getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { createMapFollowHandlers, followedCompanyIds } from "@/lib/knowledge-graph/follows";
const handlers = createMapFollowHandlers({
  async authenticate(request) {
    const token = request.headers.get("authorization");
    try { return token?.startsWith("Bearer ") ? (await verifyIdToken(token.slice(7))).uid : null; } catch { return null; }
  },
  async read(uid) { return (await getAdminFirestore().collection("users").doc(uid).get()).data()?.followedCompanyIds; },
  async exists(id) {
    const company = await getAdminFirestore().collection("companies").doc(id).get();
    return company.exists && ["PUBLISHED", "DIRECTORY"].includes(company.data()?.status);
  },
  async update(uid, id, follow) {
    const db = getAdminFirestore(); const ref = db.collection("users").doc(uid);
    return db.runTransaction(async tx => {
      const doc = await tx.get(ref); const current = followedCompanyIds(doc.data()?.followedCompanyIds);
      const next = follow ? [...new Set([...current, id])] : current.filter(companyId => companyId !== id);
      if (next.length > 200) throw new Error("Follow limit reached");
      tx.set(ref, { followedCompanyIds: next }, { merge: true }); return next;
    });
  }
});
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
