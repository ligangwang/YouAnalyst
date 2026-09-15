import { getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { createMapFollowHandlers } from "@/lib/knowledge-graph/follows";
import { readCompanyFollows, updateCompanyFollow } from "@/lib/company-follows-store";
const handlers = createMapFollowHandlers({
  async authenticate(request) {
    const token = request.headers.get("authorization");
    try { return token?.startsWith("Bearer ") ? (await verifyIdToken(token.slice(7))).uid : null; } catch { return null; }
  },
  read: readCompanyFollows,
  async exists(id) {
    const company = await getAdminFirestore().collection("companies").doc(id).get();
    return company.exists && ["PUBLISHED", "DIRECTORY"].includes(company.data()?.status);
  },
  update: updateCompanyFollow,
});
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
