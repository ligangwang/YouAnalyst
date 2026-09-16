import type { KnowledgeGraph } from "./model";
import { relationshipVerification } from "./relationship-status";

export type BusinessEvent = {
  id: string; category: "ORDER" | "CAPACITY" | "PRODUCT" | "PARTNERSHIP";
  companyIds: string[]; relationshipId?: string;
  eventDate: string | null; sourceDate: string; collectedAt: string;
  title: string; titleZh: string; summary: string; summaryZh: string;
  sourceTitle: string; sourceUrl: string; planned: boolean;
};
export type UpdateReason = { followedId: string; companyId: string; edgeId?: string; role?: "supplier" | "customer" };
/** Exactly one supply-chain hop; partnerships/competition never imply upstream exposure. */
export function updateReasons(graph: KnowledgeGraph, follows: string[], companyIds: string[]): UpdateReason[] {
  const ids = new Set(companyIds), results: UpdateReason[] = [];
  for (const followedId of [...new Set(follows)]) {
    if (ids.has(followedId)) { results.push({ followedId, companyId: followedId }); continue; }
    for (const edge of graph.relationships) {
      if (!["SUPPLIER_OF", "CUSTOMER_OF"].includes(edge.type) || relationshipVerification(edge) === "TERMINATED") continue;
      const supplier = edge.type === "SUPPLIER_OF" ? edge.source : edge.target;
      const customer = edge.type === "SUPPLIER_OF" ? edge.target : edge.source;
      const companyId = followedId === supplier ? customer : followedId === customer ? supplier : null;
      if (companyId && ids.has(companyId)) results.push({ followedId, companyId, edgeId: edge.id, role: companyId === supplier ? "supplier" : "customer" });
    }
  }
  return results;
}
export function eventMapUrl(companyId: string, eventId?: string, edgeId?: string) {
  return `/?${new URLSearchParams({ company: companyId, ...(eventId ? { event: eventId } : {}), ...(edgeId ? { relationship: edgeId } : {}) })}`;
}
