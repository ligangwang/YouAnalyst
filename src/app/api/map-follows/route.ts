import { getAdminFirestore, verifyIdToken } from "@/lib/firebase/admin";
import { createMapFollowHandlers } from "@/lib/knowledge-graph/follows";
import { readCompanyFollows, updateCompanyFollow } from "@/lib/company-follows-store";
import { nvidiaEditorialCompany } from "@/lib/research/nvidia-manufacturing";
const handlers = createMapFollowHandlers({
  async authenticate(request) {
    const token = request.headers.get("authorization");
    try { return token?.startsWith("Bearer ") ? (await verifyIdToken(token.slice(7))).uid : null; } catch { return null; }
  },
  read: readCompanyFollows,
  async exists(id) {
    const company = await getAdminFirestore().collection("companies").doc(id).get();
    const data = nvidiaEditorialCompany(id, company.exists ? company.data() ?? {} : undefined);
    return !!data && typeof data.name === "string" && ["PUBLISHED", "DIRECTORY"].includes(String(data.status));
  },
  update: updateCompanyFollow,
});
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
