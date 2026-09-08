import { COMPANY_GRAPH_EXTRACTION_VERSION, COMPANY_GRAPH_RELATIONSHIP_TYPES, COMPANY_GRAPH_EDGE_DIRECTIONS, type CompanyGraphRelationshipType } from "../company-graph/types";
import { INDUSTRY_STARTERS, type IndustrySegment } from "./catalog";
import { displayRelationshipTargetName, reviewRelationship, type RelationshipQualityReview } from "../company-graph/quality";

export type IndustryNode = {
  id: string;
  name: string;
  ticker: string | null;
  segment: IndustrySegment;
  kind: "issuer" | "mention" | "category" | "coverage";
};
export type IndustryEvidence = {
  id: string;
  quote: string;
  filingDate: string;
  filingUrl: string;
  issuerTicker: string;
  nameMatched: boolean;
  qualityReview?: RelationshipQualityReview;
};
export type IndustryEdge = {
  id: string;
  source: string;
  target: string;
  type: CompanyGraphRelationshipType;
  bidirectional: boolean;
  evidence: IndustryEvidence[];
};
export type IndustryGraph = {
  nodes: IndustryNode[];
  edges: IndustryEdge[];
  coveredTickers: string[];
  updatedAt: string | null;
  omittedEdges: number;
  withheldEdges?: number;
};
export const RELATIONSHIP_LABELS: Record<CompanyGraphRelationshipType, string> = {
  SUPPLIER_OF: "supplies", CUSTOMER_OF: "buys from", COMPETES_WITH: "competes with",
  PARTNER_OF: "partners with", DISTRIBUTES_FOR: "distributes for", MANUFACTURES_FOR: "manufactures for",
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// A read-only visualization projection. These IDs are not company master IDs.
// Name-based connections are explicitly provisional, never written as identity merges.
export function buildIndustryGraph(runs: Record<string, unknown>): IndustryGraph {
  const nodes = new Map<string, IndustryNode>();
  const issuers = new Map<string, { node: IndustryNode; cik: string; result: Record<string, unknown> }>();
  const names = new Map<string, Set<string>>();
  const coveredTickers: string[] = [];
  let updatedAt: string | null = null;
  for (const starter of INDUSTRY_STARTERS) {
    const run = record(runs[starter.ticker]);
    const result = record(run.result);
    const cik = text(result.cik);
    const valid = starter.filingForm !== "20-F" && run.status === "COMPLETED" && run.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION &&
      result.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION && result.dryRun === false &&
      result.ticker === starter.ticker && /^\d{10}$/.test(cik) && text(result.companyName) &&
      Array.isArray(result.edges);
    const node: IndustryNode = {
      id: valid ? `sec:${cik}` : `coverage:${starter.ticker}`,
      name: starter.name, ticker: starter.ticker, segment: starter.segment, kind: valid ? "issuer" : "coverage",
    };
    nodes.set(node.id, node);
    // Register editorial names even before the company's own filing is covered.
    // All name joins stay provisional and never change persistent company identity.
    for (const name of [starter.name, ...(starter.aliases ?? []), ...(valid ? [text(result.companyName)] : [])]) {
      const key = nameKey(name);
      names.set(key, new Set([...(names.get(key) ?? []), node.id]));
    }
    if (!valid) continue;
    coveredTickers.push(starter.ticker);
    issuers.set(starter.ticker, { node, cik, result });
    const date = text(run.updatedAt);
    if (date && Number.isFinite(Date.parse(date)) && (!updatedAt || date > updatedAt)) updatedAt = date;
  }
  const edges = new Map<string, IndustryEdge>();
  let omittedEdges = 0;
  let withheldEdges = 0;
  // Interleave candidates so a dense first issuer cannot exhaust the preview
  // before later issuers contribute. Bounds and evidence validation are unchanged.
  for (const { result } of issuers.values()) {
    if (/^\d{10}-\d{2}-\d{6}$/.test(text(record(result.filing).accessionNumber))) {
      omittedEdges += Math.max(0, (result.edges as unknown[]).length - 50);
    }
  }
  for (let edgeIndex = 0; edgeIndex < 50; edgeIndex++) {
    for (const [ticker, { node, cik, result }] of issuers) {
      const filing = record(result.filing);
      const accession = text(filing.accessionNumber);
      if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
      const rawEdges = result.edges as unknown[];
      if (edgeIndex >= rawEdges.length) continue;
      const value = rawEdges[edgeIndex];
      const raw = reviewRelationship(record(value));
      if (!raw) { withheldEdges++; continue; }
      const targetName = displayRelationshipTargetName(text(raw.targetName)).slice(0, 160);
      const quote = text(raw.evidenceText);
      const type = text(raw.relationshipType) as CompanyGraphRelationshipType;
      const direction = text(raw.direction);
      const filingDate = text(raw.filingDate);
      if (!targetName || !quote || !text(raw.id) || raw.sourceTicker !== ticker || raw.sourceCik !== cik ||
          raw.accessionNumber !== accession || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate) ||
          !COMPANY_GRAPH_RELATIONSHIP_TYPES.includes(type) ||
          !(COMPANY_GRAPH_EDGE_DIRECTIONS as readonly string[]).includes(direction) ||
          !["company", "category"].includes(text(raw.targetType)) ||
          typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0.45 || raw.confidence > 1) continue;
      const category = raw.targetType === "category";
      const matches = category ? undefined : names.get(nameKey(targetName));
      const matchedId = matches?.size === 1 ? [...matches][0] : null;
      // Unresolved mentions remain scoped to the issuer; similarly named companies are not merged globally.
      const targetId = matchedId ?? `${category ? "category" : "mention"}:${cik}:${nameKey(targetName)}`;
      if (targetId === node.id) continue;
      const sourceId = direction === "target_to_source" ? targetId : node.id;
      const destinationId = direction === "target_to_source" ? node.id : targetId;
      const endpoints = direction === "bidirectional" ? [sourceId, destinationId].sort() : [sourceId, destinationId];
      const id = JSON.stringify([...endpoints, type, direction === "bidirectional"]);
      if ((!nodes.has(targetId) && nodes.size >= 60) || (!edges.has(id) && edges.size >= 120)) {
        omittedEdges++;
        continue;
      }
      if (!nodes.has(targetId)) nodes.set(targetId, {
        id: targetId, name: targetName, ticker: null, segment: "other", kind: category ? "category" : "mention",
      });
      const edge = edges.get(id) ?? {
        id, source: endpoints[0], target: endpoints[1], type,
        bidirectional: direction === "bidirectional", evidence: [],
      };
      if (!edge.evidence.some((item) => item.id === raw.id)) edge.evidence.push({
        id: text(raw.id), quote: quote.slice(0, 2000), filingDate, issuerTicker: ticker, nameMatched: Boolean(matchedId),
        ...(raw.qualityReview ? { qualityReview: raw.qualityReview } : {}),
        filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${accession}-index.html`,
      });
      edges.set(id, edge);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], coveredTickers, updatedAt, omittedEdges, withheldEdges };
}

export function selectNeighborhood(graph: IndustryGraph, roots: string[], type: string, categories: boolean, overview = false) {
  const starters = new Set(graph.nodes.filter((node) => node.kind === "issuer" || node.kind === "coverage").map((node) => node.id));
  const edges = graph.edges.filter((edge) => (type === "all" || edge.type === type) &&
    (!overview || (starters.has(edge.source) && starters.has(edge.target))) &&
    (categories || (!edge.source.startsWith("category:") && !edge.target.startsWith("category:"))) &&
    (!roots.length || roots.includes(edge.source) || roots.includes(edge.target)));
  const visibleIds = new Set([...roots, ...edges.flatMap((edge) => [edge.source, edge.target])]);
  return {
    edges,
    nodes: graph.nodes.filter((node) => (!roots.length && ["issuer", "coverage"].includes(node.kind)) || visibleIds.has(node.id)),
  };
}
