import type { Firestore } from "firebase-admin/firestore";
import { graphMembership, relationshipId, type MarketCompany, type MarketRelationship } from "./market-store";
import { NVIDIA_EDITORIAL_COMPANIES, NVIDIA_MANUFACTURING_FACTS, NVIDIA_MANUFACTURING_REVIEWED, NVIDIA_MANUFACTURING_SOURCE } from "../research/nvidia-manufacturing";

const publicCompany = (company: MarketCompany | undefined) => company && ["PUBLISHED", "DIRECTORY"].includes(String(company.status)) &&
  company.name && (!graphMembership(company) || graphMembership(company)?.status === "PUBLISHED");
const canonical = (row: MarketRelationship) => row.type === "CUSTOMER_OF"
  ? relationshipId(row.target, row.source, "SUPPLIER_OF") : relationshipId(row.source, row.target, row.type);

/** Inputs include all statuses for NVIDIA relationships and both exact directory IDs, even hidden rows. */
export function projectNvidiaManufacturing(companies: MarketCompany[], records: MarketRelationship[]) {
  if (!publicCompany(companies.find(company => company.id === "US:NVDA"))) return { companies, records };
  const projectedCompanies = [...companies];
  for (const company of NVIDIA_EDITORIAL_COMPANIES) {
    if (!projectedCompanies.some(remote => remote.id === company.id)) projectedCompanies.push(structuredClone(company));
  }
  const projectedRecords = [...records];
  for (const { source, fact } of NVIDIA_MANUFACTURING_FACTS) {
    if (!publicCompany(projectedCompanies.find(company => company.id === source))) continue;
    const id = relationshipId(source, "US:NVDA", "SUPPLIER_OF");
    const matches = records.filter(row => row.id === id || canonical(row) === id);
    // An editor's status, conflicting legacy key, duplicate, or pending/terminated/newer review is authoritative.
    if (matches.length > 1) continue;
    const old = matches[0];
    // Malformed remote editorial data is authoritative too: leave it for repair rather than
    // dropping an unreadable review/status or making the entire graph unavailable here.
    const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
    if (old && ((old.researchFacts !== undefined && (!Array.isArray(old.researchFacts) || !old.researchFacts.every(object))) ||
      (old.evidence !== undefined && (!Array.isArray(old.evidence) || !old.evidence.every(object))))) continue;
    const facts = Array.isArray(old?.researchFacts) ? old.researchFacts as Record<string, unknown>[] : [];
    if (old && (old.status !== "PUBLISHED" || canonical(old) !== id ||
      String(old.researchReviewedAt ?? "") >= NVIDIA_MANUFACTURING_REVIEWED ||
      facts.some(f => ["PENDING", "TERMINATED"].includes(String(f.verificationStatus)) || String(f.reviewedAt ?? "") >= NVIDIA_MANUFACTURING_REVIEWED))) continue;
    const evidence = [...(old?.evidence ?? [])];
    const existingSource = evidence.find(item => item.url === NVIDIA_MANUFACTURING_SOURCE.url && item.id);
    const sourceId = existingSource?.id ?? NVIDIA_MANUFACTURING_SOURCE.id;
    if (!existingSource) evidence.push(NVIDIA_MANUFACTURING_SOURCE);
    // Keep remote evidence/facts and identity. Only this checked fact is appended to an older published row.
    const addedFact = { ...fact, sourceIds: [sourceId] };
    const result: MarketRelationship = {
      ...old, id: old?.id ?? id, source: old?.source ?? source, target: old?.target ?? "US:NVDA", type: old?.type ?? "SUPPLIER_OF",
      status: "PUBLISHED", commercialStatus: "DOCUMENTED",
      summary: [old?.summary, fact.scope].filter(Boolean).join(" "), evidence,
      researchFacts: [...facts, addedFact],
      // No publication timestamp: checking a historical filing is not a new business event.
      researchReviewedAt: NVIDIA_MANUFACTURING_REVIEWED,
    };
    const index = old ? projectedRecords.indexOf(old) : -1;
    if (index >= 0) projectedRecords[index] = result;
    else projectedRecords.push(result);
  }
  return { companies: projectedCompanies, records: projectedRecords };
}

/** No writes or error fallback. Failed reads propagate rather than manufacturing a current directory. */
export async function loadNvidiaManufacturingProjection(db: Firestore, companies: MarketCompany[], records: MarketRelationship[]) {
  if (!companies.some(company => company.id === "US:NVDA" && publicCompany(company))) return { companies, records };
  const [identities, exactRelationships, incoming, outgoing] = await Promise.all([
    db.getAll(...NVIDIA_MANUFACTURING_FACTS.map(({ source }) => db.collection("companies").doc(source))),
    db.getAll(...NVIDIA_MANUFACTURING_FACTS.map(({ source }) => db.collection("company_relationships").doc(relationshipId(source, "US:NVDA", "SUPPLIER_OF")))),
    db.collection("company_relationships").where("target", "==", "US:NVDA").get(),
    db.collection("company_relationships").where("source", "==", "US:NVDA").get(),
  ]);
  const byCompany = new Map(companies.map(company => [company.id, company]));
  for (const doc of identities) {
    if (doc.exists) byCompany.set(doc.id, { ...doc.data(), id: doc.id } as MarketCompany);
  }
  const byRelationship = new Map(records.map(record => [record.id, record]));
  // Exact keys also catch suppressed or corrupt rows whose endpoints no longer match either query.
  for (const doc of [...incoming.docs, ...outgoing.docs, ...exactRelationships.filter(doc => doc.exists)]) byRelationship.set(doc.id, { ...doc.data(), id: doc.id } as MarketRelationship);
  return projectNvidiaManufacturing([...byCompany.values()], [...byRelationship.values()]);
}
