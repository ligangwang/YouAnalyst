import { filingRelationship, filingRelationshipId } from "./market-storage";
import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  buildCompanyGraphExtractionText,
  fetchLatest10K,
  fetchLatest10KSections,
  resolveSecCompanyByTicker,
  summarizeStoredSections,
} from "@/lib/company-graph/sec";
import { collapseCompanyGraphEntityEdges } from "@/lib/company-graph/entities";
import { extractCompanyGraphRelationships } from "@/lib/company-graph/openai";
import {
  COMPANY_GRAPH_EXTRACTION_VERSION,
  type CompanyGraphEdge,
  type CompanyGraphExtractionResult,
  type CompanyGraphTargetType,
} from "@/lib/company-graph/types";
import { safeRecordOpenAiUsageEvent } from "@/lib/openai/usage";

export type CompanyGraphExtractionInput = {
  ticker: string;
  dryRun?: boolean;
  force?: boolean;
};

const MIN_EDGE_CONFIDENCE = 0.45;
const EDGE_BATCH_SIZE = 450;
const MAX_CATEGORY_EDGES = 8;
const GENERIC_TARGET_PATTERNS = [
  /\b(vendors?|suppliers?|providers?|retailers?|publishers?|manufacturers?|producers?|distributors?|developers?|licensors?)\b/i,
  /\bcompanies\b/i,
  /\b(businesses|firms|organizations|groups)\s+(that|who|which|with|providing|provide|offering|offer|manufacture|sell|distribute)\b/i,
  /\b(cloud(?:-based)? services?|cloud service providers?|endpoint security|hyperscalers?|identity vendors?|job boards?|online gaming|open source|search engines?|security solutions?|social networks?|virtual assistants?|web portals?)\b/i,
  /\b(OEMs?|VARs?|CSPs?|ISVs?|SIs?)\b/,
];
const CATEGORY_RELATIONSHIP_WEIGHTS: Record<CompanyGraphEdge["relationshipType"], number> = {
  SUPPLIER_OF: 60,
  CUSTOMER_OF: 55,
  MANUFACTURES_FOR: 50,
  DISTRIBUTES_FOR: 45,
  COMPETES_WITH: 35,
  PARTNER_OF: 25,
};
const LOW_INFORMATION_CATEGORY_NAMES = new Set([
  "businesses",
  "cloud service",
  "cloud services",
  "companies",
  "developers",
  "distributors",
  "firms",
  "groups",
  "manufacturers",
  "organizations",
  "producers",
  "providers",
  "publishers",
  "retailers",
  "suppliers",
  "vendors",
]);
const LOW_INFORMATION_CATEGORY_PATTERNS = [
  /\b(and other|among others|including|products we offer|products and services)\b/i,
  /\b(companies|businesses|firms|organizations|groups)\s+(that|who|which|with)\b/i,
  /\b(services?|platforms?|solutions?|products?)\b/i,
];
const MATERIAL_CATEGORY_PATTERNS = [
  /\b(advertising|china-based|cloud infrastructure|component|components|content|contract|data center|e-commerce|foreign|fulfillment|hardware|infrastructure|licensors?|logistics|marketplace|semiconductor|third-party|technology)\b/i,
  /\b(qualified|strategic)\s+(vendors?|suppliers?|providers?|partners?)\b/i,
  /\b(vendors?|suppliers?|providers?)\s+for\s+[a-z0-9 -]+\b/i,
];

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function edgeId(input: {
  accessionNumber: string;
  sourceTicker: string;
  relationshipType: string;
  targetName: string;
  evidenceText: string;
}): string {
  const hash = createHash("sha256")
    .update([
      input.accessionNumber,
      input.sourceTicker,
      input.relationshipType,
      input.targetName.toLowerCase(),
      input.evidenceText.toLowerCase(),
    ].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `${input.sourceTicker}_${input.accessionNumber.replace(/-/g, "")}_${hash}`;
}

function runDocId(ticker: string): string {
  return `${ticker}_latest_10k`;
}

function edgeDocIdPrefix(ticker: string, accessionNumber: string): string {
  return `${ticker}_${accessionNumber.replace(/-/g, "")}_`;
}

function readCachedResult(data: Record<string, unknown> | undefined): CompanyGraphExtractionResult | null {
  const result = data?.result;
  if (!result || typeof result !== "object") {
    return null;
  }

  return result as CompanyGraphExtractionResult;
}

function normalizeGraphTargetType(targetName: string, targetType: CompanyGraphTargetType): CompanyGraphTargetType {
  const normalizedName = targetName.trim();
  if (!normalizedName) {
    return targetType;
  }

  if (GENERIC_TARGET_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return "category";
  }

  return targetType;
}

function categoryEdgeScore(edge: CompanyGraphEdge): number {
  const normalizedName = edge.targetName.trim().toLowerCase();
  const wordCount = normalizedName.split(/\s+/).filter(Boolean).length;
  const specificityScore = Math.min(wordCount, 6) * 4;
  const lowInformationPenalty = LOW_INFORMATION_CATEGORY_NAMES.has(normalizedName) ? 25 : 0;

  return CATEGORY_RELATIONSHIP_WEIGHTS[edge.relationshipType] +
    edge.confidence * 100 +
    specificityScore -
    lowInformationPenalty;
}

function isLowInformationCategory(edge: CompanyGraphEdge): boolean {
  const normalizedName = edge.targetName.trim().toLowerCase();
  const words = normalizedName.split(/\s+/).filter(Boolean);

  if (LOW_INFORMATION_CATEGORY_NAMES.has(normalizedName)) {
    return true;
  }

  if (edge.relationshipType === "COMPETES_WITH") {
    return true;
  }

  if (!MATERIAL_CATEGORY_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return true;
  }

  if (words.length <= 2 && LOW_INFORMATION_CATEGORY_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return true;
  }

  return words.length > 6 || LOW_INFORMATION_CATEGORY_PATTERNS.slice(0, 2).some((pattern) => pattern.test(normalizedName));
}

function isCachedResultForFiling(
  result: CompanyGraphExtractionResult | null,
  accessionNumber: string,
): result is CompanyGraphExtractionResult {
  return result?.filing.accessionNumber === accessionNumber &&
    result.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION;
}

async function persistEdges(db: FirebaseFirestore.Firestore, edges: CompanyGraphEdge[], filingUrl: string): Promise<number> {
  let written = 0;

  for (let index = 0; index < edges.length; index += EDGE_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = edges.slice(index, index + EDGE_BATCH_SIZE);
    const refs = chunk.map(edge => db.collection("market_company_relationships").doc(filingRelationshipId(edge.id)));
    const previous = await db.getAll(...refs);

    for (const [i, edge] of chunk.entries()) {
      if (["PUBLISHED", "WITHDRAWN"].includes(previous[i].data()?.status)) continue;
      batch.set(refs[i], filingRelationship(edge, filingUrl), { merge: true });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

async function deleteStaleEdgesForFiling(
  db: FirebaseFirestore.Firestore,
  input: {
    sourceTicker: string;
    accessionNumber: string;
    currentEdgeIds: Set<string>;
  },
): Promise<number> {
  const edgePrefix = filingRelationshipId(edgeDocIdPrefix(input.sourceTicker, input.accessionNumber));
  const snapshot = await db
    .collection("market_company_relationships")
    .where(FieldPath.documentId(), ">=", edgePrefix)
    .where(FieldPath.documentId(), "<", `${edgePrefix}\uf8ff`)
    .orderBy(FieldPath.documentId())
    .get();
  const staleDocs = snapshot.docs.filter((doc) => doc.data().status === "NEEDS_REVIEW" && !input.currentEdgeIds.has(doc.id.slice("filing:".length)));
  let deleted = 0;

  for (let index = 0; index < staleDocs.length; index += EDGE_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = staleDocs.slice(index, index + EDGE_BATCH_SIZE);

    for (const doc of chunk) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

function limitCategoryEdges(edges: CompanyGraphEdge[]): CompanyGraphEdge[] {
  const filteredEdges = edges.filter((edge) => edge.targetType !== "category" || !isLowInformationCategory(edge));
  const categoryEdgesById = new Set(filteredEdges
    .filter((edge) => edge.targetType === "category")
    .sort((left, right) => {
      const scoreDelta = categoryEdgeScore(right) - categoryEdgeScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.targetName.localeCompare(right.targetName);
    })
    .slice(0, MAX_CATEGORY_EDGES)
    .map((edge) => edge.id));

  return filteredEdges.filter((edge) => {
    if (edge.targetType !== "category") {
      return true;
    }

    return categoryEdgesById.has(edge.id);
  });
}

export async function runLatest10KCompanyGraphExtraction(
  input: CompanyGraphExtractionInput,
): Promise<CompanyGraphExtractionResult> {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) {
    throw new Error("Ticker is required.");
  }

  const dryRun = input.dryRun !== false;
  const force = input.force === true;
  const db = getAdminFirestore();
  const runRef = db.collection("company_research_runs").doc(runDocId(ticker));
  const company = await resolveSecCompanyByTicker(ticker);
  const filing = await fetchLatest10K(company.cik);

  if (!force) {
    const runSnapshot = await runRef.get();
    const cachedResult = readCachedResult(runSnapshot.data());
    if (isCachedResultForFiling(cachedResult, filing.accessionNumber)) {
      return {
        ...cachedResult,
        dryRun,
        cached: true,
      };
    }
  }

  const existingFilingSnapshot = await db.collection("sec_filings").doc(filing.accessionNumber).get();
  const existingFilingData = existingFilingSnapshot.data() as Record<string, unknown> | undefined;

  if (!force) {
    const existingResult = readCachedResult(existingFilingData?.companyGraphLatestResult as Record<string, unknown> | undefined);
    if (isCachedResultForFiling(existingResult, filing.accessionNumber)) {
      return {
        ...existingResult,
        dryRun,
        cached: true,
      };
    }
  }

  const sections = await fetchLatest10KSections(company.cik, filing);
  const storedSections = summarizeStoredSections(sections);
  const extractionText = buildCompanyGraphExtractionText(sections);

  if (!extractionText) {
    throw new Error(`No extractable latest 10-K text found for ${ticker}.`);
  }

  const openAiResult = await extractCompanyGraphRelationships({
    companyName: company.name,
    ticker,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    extractionText,
  });
  const nowIso = new Date().toISOString();
  const runId = `${ticker}_${filing.accessionNumber.replace(/-/g, "")}_${Date.now()}`;
  const usageEvent = await safeRecordOpenAiUsageEvent({
    purpose: "company_graph_extraction",
    model: openAiResult.model,
    responseId: openAiResult.responseId,
    usage: openAiResult.usage,
    createdAt: nowIso,
    metadata: {
      ticker,
      companyName: company.name,
      cik: company.cik,
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
      dryRun,
      force,
      runId,
    },
  });
  const edges: CompanyGraphEdge[] = limitCategoryEdges(collapseCompanyGraphEntityEdges(openAiResult.relationships
    .filter((relationship) => relationship.confidence >= MIN_EDGE_CONFIDENCE)
    .map((relationship) => {
      const targetType = normalizeGraphTargetType(relationship.targetName, relationship.targetType);

      return {
        id: edgeId({
          accessionNumber: filing.accessionNumber,
          sourceTicker: ticker,
          relationshipType: relationship.relationshipType,
          targetName: relationship.targetName,
          evidenceText: relationship.evidenceText,
        }),
        sourceName: company.name,
        sourceTicker: ticker,
        sourceCik: company.cik,
        targetName: relationship.targetName,
        targetType,
        relationshipType: relationship.relationshipType,
        direction: relationship.direction,
        evidenceText: relationship.evidenceText,
        filingType: "10-K" as const,
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        reportDate: filing.reportDate,
        section: relationship.section,
        confidence: relationship.confidence,
        extractionProvider: "openai" as const,
        extractionModel: openAiResult.model,
        extractionRunId: runId,
        createdAt: nowIso,
      };
    })));

  const result: CompanyGraphExtractionResult = {
    runId,
    extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    ticker,
    companyName: company.name,
    cik: company.cik,
    dryRun,
    cached: false,
    filing: {
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      primaryDocument: filing.primaryDocument,
      filingUrl: filing.filingUrl,
    },
    sections: storedSections.map((section) => ({
      id: section.id,
      title: section.title,
      available: section.available,
      charCount: section.charCount,
      storedCharCount: section.storedCharCount,
      truncated: section.truncated,
    })),
    extraction: {
      provider: "openai",
      model: openAiResult.model,
      responseId: openAiResult.responseId,
      usage: openAiResult.usage,
      usageEvent: usageEvent
        ? {
            id: usageEvent.id,
            estimatedCostUsd: usageEvent.estimatedCostUsd,
            inputTokens: usageEvent.inputTokens,
            cachedInputTokens: usageEvent.cachedInputTokens,
            outputTokens: usageEvent.outputTokens,
            totalTokens: usageEvent.totalTokens,
          }
        : null,
    },
    edges,
  };

  if (dryRun) {
    return result;
  }

  await db.collection("sec_filings").doc(filing.accessionNumber).set({
    accessionNumber: filing.accessionNumber,
    cik: company.cik,
    ticker,
    companyName: company.name,
    form: "10-K",
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    primaryDocument: filing.primaryDocument,
    filingUrl: filing.filingUrl,
    updatedAt: nowIso,
    companyGraphLatestResult: {
      result,
    },
  }, { merge: true });

  for (const section of storedSections) {
    await db.collection("sec_filing_sections").doc(`${filing.accessionNumber}_${section.id}`).set({
      accessionNumber: filing.accessionNumber,
      sectionId: section.id,
      title: section.title,
      text: section.text,
      available: section.available,
      charCount: section.charCount,
      storedCharCount: section.storedCharCount,
      truncated: section.truncated,
      updatedAt: nowIso,
    }, { merge: true });
  }

  await deleteStaleEdgesForFiling(db, {
    sourceTicker: ticker,
    accessionNumber: filing.accessionNumber,
    currentEdgeIds: new Set(edges.map((edge) => edge.id)),
  });
  await persistEdges(db, edges, filing.filingUrl);
  await runRef.set({
    ticker,
    cik: company.cik,
    companyName: company.name,
    accessionNumber: filing.accessionNumber,
    status: "COMPLETED",
    extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    edgeCount: edges.length,
    updatedAt: nowIso,
    result,
  }, { merge: true });

  return result;
}
