import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  COMPANY_GRAPH_EDGE_DIRECTIONS,
  COMPANY_GRAPH_EXTRACTION_VERSION,
  COMPANY_GRAPH_RELATIONSHIP_TYPES,
  type CompanyGraphEdge,
} from "@/lib/company-graph/types";
import { collapseCompanyGraphEntityEdges } from "@/lib/company-graph/entities";
import { displayRelationshipTargetName, reviewRelationships } from "@/lib/company-graph/quality";
import { FieldPath } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

const MAX_EDGES = 50;

type CompanyGraphRunDocument = {
  companyName?: unknown;
  cik?: unknown;
  accessionNumber?: unknown;
  result?: unknown;
  extractionVersion?: unknown;
  updatedAt?: unknown;
};

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRunResult(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const filing = source.filing && typeof source.filing === "object"
    ? source.filing as Record<string, unknown>
    : null;

  return {
    runId: readString(source.runId),
    filing: filing
      ? {
          accessionNumber: readString(filing.accessionNumber),
          filingDate: readString(filing.filingDate),
          reportDate: readString(filing.reportDate),
          filingUrl: readString(filing.filingUrl),
        }
      : null,
  };
}

function sortEdges(left: CompanyGraphEdge, right: CompanyGraphEdge): number {
  const confidenceDelta = right.confidence - left.confidence;
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  return left.targetName.localeCompare(right.targetName);
}

function edgeDocIdPrefix(ticker: string, accessionNumber: string): string {
  return `${ticker}_${accessionNumber.replace(/-/g, "")}_`;
}

function toCompanyGraphEdge(id: string, data: Record<string, unknown>): CompanyGraphEdge | null {
  const relationshipType = readString(data.relationshipType);
  const direction = readString(data.direction);
  const targetName = readString(data.targetName);
  const evidenceText = readString(data.evidenceText);
  const confidence = typeof data.confidence === "number" && Number.isFinite(data.confidence)
    ? data.confidence
    : null;

  if (
    !relationshipType ||
    !(COMPANY_GRAPH_RELATIONSHIP_TYPES as readonly string[]).includes(relationshipType) ||
    !direction ||
    !(COMPANY_GRAPH_EDGE_DIRECTIONS as readonly string[]).includes(direction) ||
    !targetName ||
    !evidenceText ||
    confidence === null
  ) {
    return null;
  }

  return {
    id,
    ...data,
    relationshipType,
    direction,
    targetName,
    evidenceText,
    confidence,
  } as CompanyGraphEdge;
}

function toCurrentCompanyGraphEdge(doc: FirebaseFirestore.QueryDocumentSnapshot): CompanyGraphEdge | null {
  return toCompanyGraphEdge(doc.id.replace(/^filing:/, ""), doc.data() as Record<string, unknown>);
}

function readRunResultEdges(value: unknown): CompanyGraphEdge[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const edges = (value as Record<string, unknown>).edges;
  if (!Array.isArray(edges)) {
    return null;
  }

  return edges.flatMap((edge) => {
    if (!edge || typeof edge !== "object") {
      return [];
    }

    const data = edge as Record<string, unknown>;
    const id = readString(data.id);
    const graphEdge = id ? toCompanyGraphEdge(id, data) : null;
    return graphEdge ? [graphEdge] : [];
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await context.params;
  const ticker = normalizeTicker(rawTicker);

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const db = getAdminFirestore();
    const runSnapshot = await db.collection("company_research_runs").doc(`${ticker}_latest_10k`).get();
    const runData = runSnapshot.data() as CompanyGraphRunDocument | undefined;
    const runResult = readRunResult(runData?.result);
    const extractionVersion = readString(runData?.extractionVersion);
    const isCurrentExtractionVersion = extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION;
    const latestAccessionNumber = readString(runData?.accessionNumber) ?? runResult?.filing?.accessionNumber ?? null;
    const edgePrefix = isCurrentExtractionVersion && latestAccessionNumber
      ? `filing:${edgeDocIdPrefix(ticker, latestAccessionNumber)}`
      : null;
    const resultEdges = isCurrentExtractionVersion ? readRunResultEdges(runData?.result) : null;
    const edgesSnapshot = resultEdges === null && edgePrefix
      ? await db
          .collection("market_company_relationships")
          .where(FieldPath.documentId(), ">=", edgePrefix)
          .where(FieldPath.documentId(), "<", `${edgePrefix}\uf8ff`)
          .orderBy(FieldPath.documentId())
          .limit(100)
          .get()
      : null;
    const edges = resultEdges ?? (edgesSnapshot
      ? edgesSnapshot.docs
          .map(toCurrentCompanyGraphEdge)
          .filter((edge): edge is CompanyGraphEdge => Boolean(edge))
      : []);
    const reviewed = reviewRelationships(edges);
    const currentEdges = collapseCompanyGraphEntityEdges(reviewed.edges)
      .map((edge) => ({ ...edge, targetName: displayRelationshipTargetName(edge.targetName) }))
      .sort(sortEdges)
      .slice(0, MAX_EDGES);

    return NextResponse.json({
      ticker,
      available: currentEdges.length > 0,
      extractionVersion,
      companyName: readString(runData?.companyName),
      cik: readString(runData?.cik),
      accessionNumber: latestAccessionNumber,
      updatedAt: readString(runData?.updatedAt),
      runId: runResult?.runId ?? null,
      filing: runResult?.filing ?? null,
      edges: currentEdges,
      withheldEdges: reviewed.withheldCount,
    }, { headers: { "X-Research-Storage": "company_research_runs" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch company graph";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
