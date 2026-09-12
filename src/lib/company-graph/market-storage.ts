import type { CompanyGraphEdge } from "./types";
export const FILING_RELATIONSHIP_PREFIX = "filing:";
export function filingRelationshipId(id: string) { return FILING_RELATIONSHIP_PREFIX + id; }
// Retain unresolved entities and categories as evidence observations. They are not verified listed-company identities.
export function filingRelationship(edge: CompanyGraphEdge, filingUrl?: string) {
  const url = filingUrl ?? `https://www.sec.gov/Archives/edgar/data/${Number(edge.sourceCik)}/${edge.accessionNumber.replace(/-/g,"")}/${edge.accessionNumber}-index.html`;
  return { ...edge, recordKind:"FILING_OBSERVATION", status:"NEEDS_REVIEW", source:`US:${edge.sourceTicker}`,
    evidence:[{id:filingRelationshipId(edge.id),url,title:`${edge.sourceName} ${edge.filingType} · ${edge.filingDate}`,summary:edge.evidenceText,sourceDate:edge.filingDate}],
    filingUrl:url };
}
