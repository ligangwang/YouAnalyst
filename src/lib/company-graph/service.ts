import { filingRelationship, filingRelationshipId } from "./market-storage";
import { createHash, randomUUID } from "node:crypto";
import { FieldPath, type Firestore, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  buildCompanyGraphExtractionText,
  fetchLatest10K,
  fetchLatest10KSections,
  resolveSecCompanyByTicker,
  summarizeStoredSections,
  type SecCompanyIdentity, type SecLatest10K, type SecFilingSection,
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
import type { SecFilingDiscovered } from "../sec-filings/event";
import { GRAPH_LEASE_MS, normalizeCompanyGraphTicker } from "./requests";

export type CompanyGraphExtractionInput = {
  ticker: string;
  dryRun?: boolean;
  force?: boolean;
  requestId?: string;
  requestedAt?: string;
  requestGeneration?: number;
  filing?: SecFilingDiscovered;
};
export type CompanyGraphDependencies = {
  db?: Firestore;
  resolve?: typeof resolveSecCompanyByTicker;
  latest?: typeof fetchLatest10K;
  sections?: typeof fetchLatest10KSections;
  extract?: typeof extractCompanyGraphRelationships;
  usage?: typeof safeRecordOpenAiUsageEvent;
  now?: () => number;
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

type GraphFence = { ref: DocumentReference; owner: string; now: () => number };
async function checkFence(tx: Transaction, fence?: GraphFence) {
  if (!fence) return;
  const data = (await tx.get(fence.ref)).data();
  if (data?.leaseOwner !== fence.owner || Number(data.leaseExpiresAtMs) <= fence.now()) throw new Error("Graph extraction lease expired");
}
async function fencedSet(db: Firestore, ref: DocumentReference, value: Record<string, unknown>, fence: GraphFence) {
  await db.runTransaction(async tx => { await checkFence(tx, fence); tx.set(ref, value, { merge: true }); });
}
export async function persistEdges(db: Firestore, edges: CompanyGraphEdge[], filingUrl: string, fence?: GraphFence): Promise<number> {
  // Read and write in one transaction so an editor publishing during a retry
  // cannot be overwritten by a stale read followed by a blind batch write.
  for (let index = 0; index < edges.length; index += EDGE_BATCH_SIZE) {
    const chunk = edges.slice(index, index + EDGE_BATCH_SIZE);
    await db.runTransaction(async tx => {
      await checkFence(tx, fence);
      const refs = chunk.map(edge => db.collection("company_relationships").doc(filingRelationshipId(edge.id)));
      const previous = await Promise.all(refs.map(ref => tx.get(ref)));
      for (const [i, edge] of chunk.entries()) {
        if (["PUBLISHED", "WITHDRAWN"].includes(previous[i].data()?.status)) continue;
        tx.set(refs[i], filingRelationship(edge, filingUrl), { merge: true });
      }
    });
  }
  return edges.length;
}
async function deleteStaleEdgesForFiling(db: Firestore, input: {
  sourceTicker: string; accessionNumber: string; currentEdgeIds: Set<string>;
}, fence?: GraphFence): Promise<void> {
  const prefix = filingRelationshipId(edgeDocIdPrefix(input.sourceTicker, input.accessionNumber));
  const snapshot = await db.collection("company_relationships")
    .where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", `${prefix}\uf8ff`)
    .orderBy(FieldPath.documentId()).get();
  const stale = snapshot.docs.filter(doc => !input.currentEdgeIds.has(doc.id.slice("filing:".length)));
  for (let index = 0; index < stale.length; index += EDGE_BATCH_SIZE) {
    await db.runTransaction(async tx => {
      await checkFence(tx, fence);
      const docs = await Promise.all(stale.slice(index, index + EDGE_BATCH_SIZE).map(doc => tx.get(doc.ref)));
      for (const doc of docs) if (doc.data()?.status === "NEEDS_REVIEW") tx.delete(doc.ref);
    });
  }
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

export function shouldAdvanceLatestGraph(current: Record<string, unknown> | undefined, result: CompanyGraphExtractionResult, generationAt: string, requestGeneration?: number) {
  if (!current) return true;
  const old = readCachedResult(current);
  const previousDate = old?.filing.filingDate ?? String(current.filingDate ?? "");
  const previousAccession = old?.filing.accessionNumber ?? String(current.accessionNumber ?? "");
  const order = `${result.filing.filingDate}|${result.filing.accessionNumber}`.localeCompare(`${previousDate}|${previousAccession}`);
  if (order !== 0) return order > 0;
  const priorTime = Date.parse(String(current.generationAt ?? ""));
  const time = Date.parse(generationAt);
  if (Number.isFinite(priorTime) && time !== priorTime) return time > priorTime;
  if (Number.isFinite(priorTime) && typeof current.requestGeneration === "number" && requestGeneration !== undefined) return requestGeneration >= current.requestGeneration;
  return !Number.isFinite(priorTime) || time >= priorTime;
}
async function persistCompletedResult(db: Firestore, result: CompanyGraphExtractionResult, generationAt: string, fence: GraphFence, requestGeneration?: number) {
  const now = new Date().toISOString();
  await persistEdges(db, result.edges, result.filing.filingUrl, fence);
  await deleteStaleEdgesForFiling(db, { sourceTicker: result.ticker, accessionNumber: result.filing.accessionNumber,
    currentEdgeIds: new Set(result.edges.map(edge => edge.id)) }, fence);
  // This is the completion boundary. The legacy sec_filings cache is never
  // authoritative until every section and observation is durable.
  const latest = db.collection("company_research_runs").doc(runDocId(result.ticker));
  const filingRef = db.collection("sec_filings").doc(result.filing.accessionNumber);
  await db.runTransaction(async tx => {
    await checkFence(tx, fence);
    const prior = (await tx.get(latest)).data();
    tx.set(filingRef, { cik: result.cik, ticker: result.ticker,
      companyName: result.companyName, form: "10-K", ...result.filing, updatedAt: now,
      companyGraphLatestResult: { result, persistenceCompleted: true } }, { merge: true });
    if (shouldAdvanceLatestGraph(prior, result, generationAt, requestGeneration)) tx.set(latest, {
      ticker: result.ticker, cik: result.cik, companyName: result.companyName,
      accessionNumber: result.filing.accessionNumber, filingDate: result.filing.filingDate,
      status: "COMPLETED", extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
      edgeCount: result.edges.length, updatedAt: now, generationAt, requestGeneration: requestGeneration ?? null, result,
    }, { merge: true });
  });
}

export async function runLatest10KCompanyGraphExtraction(input: CompanyGraphExtractionInput,
  dependencies: CompanyGraphDependencies = {}): Promise<CompanyGraphExtractionResult> {
  const ticker = normalizeCompanyGraphTicker(input.ticker);
  const dryRun = input.dryRun !== false, force = input.force === true;
  const db = dependencies.db ?? getAdminFirestore();
  const now = dependencies.now ?? Date.now;
  const owner = randomUUID();
  const requestId = input.requestId ?? input.filing?.eventId ?? `direct_${owner}`;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(requestId)) throw new Error("Invalid graph request identity");
  const lock = db.collection("company_research_runs").doc(`_graph_lock_${ticker}`);
  if (!dryRun) await db.runTransaction(async tx => {
    const prior = (await tx.get(lock)).data();
    if (Number(prior?.leaseExpiresAtMs) > now()) throw new Error("Company graph extraction is busy; retry delivery");
    tx.set(lock, { leaseOwner: owner, leaseExpiresAtMs: now() + GRAPH_LEASE_MS }, { merge: true });
  });
  const fence = { ref: lock, owner, now };
  const signal = AbortSignal.timeout(8 * 60_000);
  const assertLease = async () => {
    signal.throwIfAborted();
    if (!dryRun) {
      const data = (await lock.get()).data();
      if (data?.leaseOwner !== owner || Number(data.leaseExpiresAtMs) <= now()) throw new Error("Graph extraction lease expired");
    }
  };
  try {
    const sourceRef = db.collection("company_research_runs").doc(`_graph_source_${requestId}`);
    const source = dryRun ? undefined : (await sourceRef.get()).data();
    let company = source?.company as SecCompanyIdentity | undefined;
    let filing = source?.filing as SecLatest10K | undefined;
    if (!company || !filing) {
      if (input.filing) {
        const [priorRun, master, existingFiling] = await Promise.all([
          db.collection("company_research_runs").doc(runDocId(ticker)).get(),
          db.collection("companies").doc(`US:${ticker}`).get(),
          db.collection("sec_filings").doc(input.filing.accessionNumber).get(),
        ]);
        const names = [master.data()?.name, priorRun.data()?.companyName, existingFiling.data()?.companyName];
        const name = names.find(value => typeof value === "string" && value.trim()) as string | undefined;
        company = { ticker, cik: input.filing.cik, name: name ?? ticker, exchange: null };
      } else company = await (dependencies.resolve ?? resolveSecCompanyByTicker)(ticker, signal);
      if (input.filing) {
        if (input.filing.form !== "10-K" || input.filing.companyId !== ticker || input.filing.cik !== company.cik) {
          throw new Error("Graph extraction requires a matching exact 10-K filing");
        }
        filing = { accessionNumber: input.filing.accessionNumber, filingDate: input.filing.filingDate,
          reportDate: null, primaryDocument: input.filing.primaryDocument,
          filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${input.filing.accessionNumber.replace(/-/g, "")}/${input.filing.primaryDocument}` };
      } else filing = await (dependencies.latest ?? fetchLatest10K)(company.cik, signal);
      await assertLease();
      if (!dryRun) await fencedSet(db, sourceRef, { company, filing, createdAt: new Date(now()).toISOString() }, fence);
    }
    const runId = `graph_${createHash("sha256").update(JSON.stringify([ticker, filing.accessionNumber,
      COMPANY_GRAPH_EXTRACTION_VERSION, force ? requestId : "cached"])).digest("hex")}`;
    const runRef = db.collection("company_research_runs").doc(`_graph_run_${runId}`);
    const checkpoint = (await runRef.get()).data();
    const generationAt = String(checkpoint?.createdAt ?? input.requestedAt ?? source?.createdAt ?? new Date(now()).toISOString());
    const durable = readCachedResult(checkpoint);
    if (checkpoint?.completed === true && isCachedResultForFiling(durable, filing.accessionNumber) && durable.ticker === ticker) {
      return { ...durable, dryRun, cached: true };
    }
    {
      const latest = (await db.collection("company_research_runs").doc(runDocId(ticker)).get()).data();
      const cached = readCachedResult(latest);
      // Legacy COMPLETED latest documents were written last and remain valid.
      if ((!force || (input.requestedAt && cached && !shouldAdvanceLatestGraph(latest, cached, generationAt, input.requestGeneration)))
        && latest?.status === "COMPLETED" && isCachedResultForFiling(cached, filing.accessionNumber) && cached.ticker === ticker) return { ...cached, dryRun, cached: true };
    }
    if (!dryRun && !checkpoint) await fencedSet(db, runRef, { createdAt: generationAt, ticker, accessionNumber: filing.accessionNumber,
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, status: "PROCESSING" }, fence);
    let sections: SecFilingSection[];
    const sectionRefs = ["item1", "item1a"].map(id => db.collection("sec_filing_sections").doc(`${filing!.accessionNumber}_${id}`));
    const saved = await Promise.all(sectionRefs.map(ref => ref.get()));
    if (saved.every(doc => typeof doc.data()?.text === "string")) {
      sections = saved.map((doc, index) => ({ id: index === 0 ? "item1" : "item1a", title: String(doc.data()!.title), text: String(doc.data()!.text) }));
    } else sections = await (dependencies.sections ?? fetchLatest10KSections)(company.cik, filing, signal);
    const storedSections = summarizeStoredSections(sections);
    if (!sections.some(section => section.text.trim())) throw new Error(`No extractable 10-K text found for ${ticker}.`);
    await assertLease();
    if (!dryRun) for (const section of storedSections) await fencedSet(db, db.collection("sec_filing_sections").doc(`${filing.accessionNumber}_${section.id}`), {
      accessionNumber: filing.accessionNumber, sectionId: section.id, ...section, updatedAt: new Date(now()).toISOString(),
    }, fence);
    const legacyFiling = (await db.collection("sec_filings").doc(filing.accessionNumber).get()).data();
    const legacyResult = !force ? readCachedResult(legacyFiling?.companyGraphLatestResult) : null;
    let result = durable ?? (isCachedResultForFiling(legacyResult, filing.accessionNumber) && legacyResult.ticker === ticker ? legacyResult : null);
    if (!result) {
      const openAiResult = checkpoint?.providerResult as Awaited<ReturnType<typeof extractCompanyGraphRelationships>> | undefined
        ?? await (dependencies.extract ?? extractCompanyGraphRelationships)({ companyName: company.name, ticker,
          accessionNumber: filing.accessionNumber, filingDate: filing.filingDate,
          extractionText: buildCompanyGraphExtractionText(sections), signal,
          responseId: typeof checkpoint?.providerResponseId === "string" ? checkpoint.providerResponseId : undefined,
          onResponseCreated: dryRun ? undefined : async responseId => {
            await assertLease(); await fencedSet(db, runRef, { providerResponseId: responseId }, fence);
          } });
      await assertLease();
      // A crash after the provider accepts POST but before its response ID is saved
      // can repeat a paid request. At-least-once delivery is not exactly-once billing.
      if (!dryRun) await fencedSet(db, runRef, { providerResult: openAiResult, providerCompletedAt: new Date(now()).toISOString() }, fence);
      const nowIso = new Date(now()).toISOString();
      const usageEvent = await (dependencies.usage ?? safeRecordOpenAiUsageEvent)({ purpose: "company_graph_extraction",
        model: openAiResult.model, responseId: openAiResult.responseId, usage: openAiResult.usage, createdAt: nowIso,
        metadata: { ticker, companyName: company.name, cik: company.cik, accessionNumber: filing.accessionNumber,
          filingDate: filing.filingDate, dryRun, force, runId } });
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

      result = {
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
    }
    if (dryRun) return { ...result, dryRun: true };
    await assertLease();
    await fencedSet(db, runRef, { result, status: "PERSISTING" }, fence);
    await persistCompletedResult(db, result, generationAt, fence, input.requestGeneration);
    await assertLease();
    await fencedSet(db, runRef, { result, status: "PERSISTED", completed: true, completedAt: new Date(now()).toISOString() }, fence);
    return { ...result, dryRun: false };
  } finally {
    if (!dryRun) await db.runTransaction(async tx => {
      if ((await tx.get(lock)).data()?.leaseOwner === owner) tx.set(lock, { leaseOwner: null, leaseExpiresAtMs: 0 }, { merge: true });
    });
  }
}
