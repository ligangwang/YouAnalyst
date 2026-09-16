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
