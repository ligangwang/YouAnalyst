// Recovered from the original graph MVP; IDs now follow Firestore document IDs.
export const RELATIONSHIP_TYPES = ["supplier", "customer", "competitor"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export type Company = {
  id: string;
  name: string;
  ticker: string | null;
  description: string;
  metadata: Record<string, unknown>;
};
export type Relationship = {
  id: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  // Legacy labels are preserved, not translated to the extraction ontology.
  type: RelationshipType;
  weight: number | null;
  confidence: number;
  source: string | null;
  createdAt: string | null;
};
export type GraphNode = {
  id: string;
  label: string;
  ticker: string | null;
  description: string;
};
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  confidence: number;
  sourceNote: string | null;
};
export type GraphResponse = {
  centerCompanyId: string;
  relationshipTypes: RelationshipType[];
  nodes: GraphNode[];
  edges: GraphEdge[];
};
export type CompanyResponse = { company: Company; relationships: Relationship[] };
