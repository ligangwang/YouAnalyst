import reviews from "./relationship-reviews.json";
import type { CompanyGraphEdge } from "./types";

export type RelationshipQualityReview = {
  reviewedAt: string;
  reason: string;
  sourceUrl: string;
  originalRelationshipType: string;
  originalDirection: string;
  originalTargetName: string;
};

type ReviewInput = Partial<Record<"id" | "sourceTicker" | "sourceCik" | "accessionNumber" | "targetName" | "targetType" | "relationshipType" | "direction" | "evidenceText", unknown>>;
type Correction = Partial<Pick<CompanyGraphEdge, "relationshipType" | "direction" | "targetName" | "evidenceText">>;

// Presentation cleanup only; do not infer a parent company or merge legal entities.
export function displayRelationshipTargetName(name: string) {
  return name.trim().replace(/[,;]+$/u, "").trim();
}

// Read-time, evidence-specific decisions. Never alter extraction records or
// apply an old correction to a new filing, different quotation or relationship.
export function reviewRelationship<T extends ReviewInput>(edge: T): (T & { qualityReview?: RelationshipQualityReview }) | null {
  const decision = reviews.find((review) => review.expected.id === edge.id &&
    Object.entries(review.expected).every(([key, value]) => edge[key as keyof ReviewInput] === value));
  if (!decision) return edge;
  if (decision.correction === null) return null;
  return {
    ...edge,
    ...decision.correction as Correction,
    qualityReview: {
      reviewedAt: decision.reviewedAt, reason: decision.reason, sourceUrl: decision.sourceUrl,
      originalRelationshipType: decision.expected.relationshipType,
      originalDirection: decision.expected.direction,
      originalTargetName: decision.expected.targetName,
    },
  };
}

export function reviewRelationships<T extends ReviewInput>(edges: T[]) {
  const accepted: Array<T & { qualityReview?: RelationshipQualityReview }> = [];
  let withheldCount = 0;
  for (const edge of edges) {
    const reviewed = reviewRelationship(edge);
    if (reviewed) accepted.push(reviewed);
    else withheldCount++;
  }
  return { edges: accepted, withheldCount };
}
