import type { GraphEdge, GraphFact } from "./model";

export type VerificationStatus = "CONFIRMED" | "PENDING" | "TERMINATED";
export function factVerification(fact: GraphFact): VerificationStatus {
  return fact.verificationStatus ?? "PENDING";
}
/** A source documents a claim; it does not by itself verify an ongoing relationship. */
export function relationshipVerification(edge: GraphEdge): VerificationStatus {
  const facts = [...(edge.facts ?? [])].sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
  const latest = facts[0]?.reviewedAt;
  const current = facts.filter(f => f.reviewedAt === latest);
  if (!current.length || current.some(f => factVerification(f) === "PENDING")) return "PENDING";
  if (current.every(f => factVerification(f) === "TERMINATED")) return "TERMINATED";
  if (current.some(f => factVerification(f) === "TERMINATED")) return "PENDING";
  return "CONFIRMED";
}
export function verificationLabel(status: VerificationStatus, chinese: boolean) {
  return ({ CONFIRMED: ["Confirmed at review", "核实时已确认"], PENDING: ["Needs verification", "待核实"], TERMINATED: ["Terminated", "已终止"] } as const)[status][chinese ? 1 : 0];
}

/**
 * Display trust for company pages. Only facts an editor reviewed (explicit status) count; a
 * relationship with no reviewed fact is UNREVIEWED and gets no badge rather than a warning.
 * VERIFIED means the latest review confirmed it from a first-party source (see
 * data/ai-supply-chain/relationship-verification.md).
 */
export type RelationshipTrust = { status: "VERIFIED" | "NEEDS_VERIFICATION" | "TERMINATED" | "UNREVIEWED"; reviewedAt?: string };
export function relationshipTrust(edge: Pick<GraphEdge, "facts">): RelationshipTrust {
  const reviewed = (edge.facts ?? []).filter(f => f.verificationStatus);
  const reviewedAt = reviewed.map(f => f.reviewedAt ?? "").sort().at(-1);
  const current = reviewed.filter(f => (f.reviewedAt ?? "") === reviewedAt);
  const dated = reviewedAt ? { reviewedAt } : {};
  if (!current.length) return { status: "UNREVIEWED" };
  if (current.every(f => f.verificationStatus === "TERMINATED")) return { status: "TERMINATED", ...dated };
  if (current.every(f => f.verificationStatus === "CONFIRMED")) return { status: "VERIFIED", ...dated };
  return { status: "NEEDS_VERIFICATION", ...dated };
}
export function trustLabel(status: RelationshipTrust["status"], chinese: boolean) {
  return ({ VERIFIED: ["Verified", "已核实"], NEEDS_VERIFICATION: ["Needs verification", "待核实"], TERMINATED: ["Terminated", "已终止"], UNREVIEWED: ["", ""] } as const)[status][chinese ? 1 : 0];
}
