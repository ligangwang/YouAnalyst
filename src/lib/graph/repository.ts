import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { RELATIONSHIP_TYPES, type Company, type CompanyResponse, type GraphResponse, type Relationship, type RelationshipType } from "./types";

// Read-only recovery of 49c6e34: no seed fallback, migrations, or database writes.
const MAX_RELATIONSHIPS_PER_DIRECTION = 200;
const MAX_NODES = 50;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function companyId(value: unknown): string | null {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value) : text(value);
  return id && !id.includes("/") && id !== "." && id !== ".." ? id : null;
}

function mapCompany(id: string, data: Record<string, unknown> | undefined): Company | null {
  const name = text(data?.name);
  if (!data || !name) return null;
  return {
    id, name, ticker: text(data.ticker), description: text(data.description) ?? "",
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown> : {},
  };
}

function isType(value: unknown): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly unknown[]).includes(value);
}

function normalizeTypes(types?: string[]): RelationshipType[] {
  if (!types?.length) return [...RELATIONSHIP_TYPES];
  if (!types.every(isType)) throw new Error("Unsupported relationship type");
  return [...new Set(types)] as RelationshipType[];
}

function mapRelationship(id: string, data: Record<string, unknown>): Relationship | null {
  const sourceCompanyId = companyId(data.sourceCompanyId);
  const targetCompanyId = companyId(data.targetCompanyId);
  if (!sourceCompanyId || !targetCompanyId || !isType(data.type) ||
      typeof data.confidence !== "number" || !Number.isFinite(data.confidence) ||
      data.confidence < 0 || data.confidence > 1) return null;
  return {
    id, sourceCompanyId, targetCompanyId, type: data.type, confidence: data.confidence,
    weight: typeof data.weight === "number" && Number.isFinite(data.weight) ? data.weight : null,
    source: text(data.source), createdAt: text(data.createdAt),
  };
}

function boundedInteger(value: number, fallback: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : fallback;
}

export function createGraphRepository(getDb: () => Firestore = getAdminFirestore) {
  async function getCompanyById(id: string): Promise<Company | null> {
    const normalized = companyId(id);
    if (!normalized) return null;
    const doc = await getDb().collection("companies").doc(normalized).get();
    return doc.exists ? mapCompany(doc.id, doc.data()) : null;
  }

  async function getCompanyByIdOrSlug(value: string): Promise<Company | null> {
    const id = companyId(value);
    if (!id) return null;
    const exact = await getCompanyById(id);
    if (exact) return exact;
    for (const field of ["tickerLower", "nameLower"]) {
      const snapshot = await getDb().collection("companies")
        .where(field, "==", id.toLowerCase()).limit(2).get();
      // A ticker/name is not a global company identity. Never pick an arbitrary match.
      if (snapshot.docs.length > 1) throw new Error("Ambiguous company lookup; use a company ID");
      if (snapshot.docs.length) return mapCompany(snapshot.docs[0].id, snapshot.docs[0].data());
    }
    return null;
  }

  async function searchCompanies(query: string, limit = 10): Promise<Company[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const count = boundedInteger(limit, 10, 20);
    const snapshots = await Promise.all(["nameLower", "tickerLower"].map((field) =>
      getDb().collection("companies").where(field, ">=", q).where(field, "<=", `${q}\uf8ff`)
        .orderBy(field).limit(count).get(),
    ));
    const companies = new Map<string, Company>();
    for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
      const company = mapCompany(doc.id, doc.data());
      if (company) companies.set(company.id, company);
    }
    return [...companies.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, count);
  }

  async function getRelationshipsForCompany(id: string, types: RelationshipType[]): Promise<Relationship[]> {
    // Existing seed references are numbers; new references may be document-ID strings.
    // Only include the numeric equivalent if it cannot alias a distinct ID (e.g. "001").
    const numeric = Number(id);
    const references: (string | number)[] = [id];
    if (Number.isSafeInteger(numeric) && numeric >= 0 && String(numeric) === id) references.push(numeric);
    const snapshots = await Promise.all(["sourceCompanyId", "targetCompanyId"].map((field) =>
      getDb().collection("relationships").where(field, "in", references)
        .limit(MAX_RELATIONSHIPS_PER_DIRECTION + 1).get(),
    ));
    // Single-field queries avoid reinstating the removed composite indexes.
    // Fail explicitly instead of presenting an arbitrary truncated neighborhood as complete.
    if (snapshots.some((snapshot) => snapshot.docs.length > MAX_RELATIONSHIPS_PER_DIRECTION)) {
      throw new Error("Company relationship limit exceeded; pagination is required");
    }
    const relationships = new Map<string, Relationship>();
    for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
      const relationship = mapRelationship(doc.id, doc.data());
      if (relationship && types.includes(relationship.type)) relationships.set(relationship.id, relationship);
    }
    return [...relationships.values()].sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  }

  async function getCompanyWithRelationships(value: string, types?: string[]): Promise<CompanyResponse | null> {
    const normalizedTypes = normalizeTypes(types);
    const company = await getCompanyByIdOrSlug(value);
    if (!company) return null;
    return { company, relationships: await getRelationshipsForCompany(company.id, normalizedTypes) };
  }

  async function getGraph(value: string, types?: string[], maxNodes = MAX_NODES): Promise<GraphResponse | null> {
    const relationshipTypes = normalizeTypes(types);
    const result = await getCompanyWithRelationships(value, relationshipTypes);
    if (!result) return null;
    const { company, relationships } = result;
    const limit = boundedInteger(maxNodes, MAX_NODES, MAX_NODES);
    const selected = new Map<string, Company>([[company.id, company]]);
    const missing = new Set<string>();
    for (const relationship of relationships) {
      if (selected.size >= limit) break;
      const neighbor = relationship.sourceCompanyId === company.id
        ? relationship.targetCompanyId : relationship.sourceCompanyId;
      if (selected.has(neighbor) || missing.has(neighbor)) continue;
      const found = await getCompanyById(neighbor);
      if (found) selected.set(neighbor, found);
      else missing.add(neighbor);
    }
    return {
      centerCompanyId: company.id, relationshipTypes,
      nodes: [...selected.values()].map((item) => ({
        id: item.id, label: item.name, ticker: item.ticker, description: item.description,
      })),
      edges: relationships.filter((item) => selected.has(item.sourceCompanyId) && selected.has(item.targetCompanyId))
        .map((item) => ({
          id: `rel-${item.id}`, source: item.sourceCompanyId, target: item.targetCompanyId,
          type: item.type, confidence: item.confidence, sourceNote: item.source,
        })),
    };
  }

  return { getCompanyById, getCompanyByIdOrSlug, searchCompanies, getCompanyWithRelationships, getGraph };
}

export const { getCompanyById, getCompanyByIdOrSlug, searchCompanies, getCompanyWithRelationships, getGraph } = createGraphRepository();
