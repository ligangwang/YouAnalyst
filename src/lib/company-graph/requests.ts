import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "@/lib/company-graph/types";

export type CompanyGraphRequestStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type CompanyGraphRequestDocument = {
  ticker: string;
  status: CompanyGraphRequestStatus;
  requestedCount: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  error: string | null;
  extractionVersion: typeof COMPANY_GRAPH_EXTRACTION_VERSION;
  edgeCount?: number;
  processingStartedAt?: string | null;
  processingRunId?: string | null;
  attemptCount?: number;
};

export type CompanyGraphRequestQueueResult = {
  ticker: string;
  status: "AVAILABLE" | "QUEUED" | "ALREADY_QUEUED";
  message: string;
};

export type CompanyGraphRequestListItem = CompanyGraphRequestDocument & {
  id: string;
};

function normalizeTicker(value: string): string {
  return value.trim().replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function isValidTicker(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(value);
}

function readStatus(value: unknown): CompanyGraphRequestStatus {
  return value === "PROCESSING" || value === "COMPLETED" || value === "FAILED" ? value : "QUEUED";
}

function numberFromValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFromValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requestTimestampFromData(data: Record<string, unknown>): string {
  return stringFromValue(data.lastRequestedAt) ??
    stringFromValue(data.firstRequestedAt) ??
    stringFromValue(data.processingStartedAt) ??
    stringFromValue(data.completedAt) ??
    stringFromValue(data.updatedAt) ??
    "";
}

function firstRequestTimestampFromData(data: Record<string, unknown>): string {
  return stringFromValue(data.firstRequestedAt) ?? requestTimestampFromData(data);
}

export async function hasCurrentCompanyGraph(ticker: string): Promise<boolean> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return false;
  }

  const runSnapshot = await getAdminFirestore().collection("company_research_runs").doc(`${normalizedTicker}_latest_10k`).get();
  const runData = runSnapshot.data() as Record<string, unknown> | undefined;

  return runData?.extractionVersion === COMPANY_GRAPH_EXTRACTION_VERSION &&
    typeof runData.edgeCount === "number" &&
    runData.edgeCount > 0;
}

export async function enqueueCompanyGraphRequest(rawTicker: string): Promise<CompanyGraphRequestQueueResult> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker || !isValidTicker(ticker)) {
    throw new Error("Enter a valid ticker.");
  }

  if (await hasCurrentCompanyGraph(ticker)) {
    return {
      ticker,
      status: "AVAILABLE",
      message: `${ticker} graph is ready.`,
    };
  }

  const db = getAdminFirestore();
  const requestRef = db.collection("company_research_requests").doc(ticker);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    const current = snapshot.data() as Record<string, unknown> | undefined;
    const currentStatus = readStatus(current?.status);
    const requestedCount = numberFromValue(current?.requestedCount);
    const isActive = currentStatus === "QUEUED" || currentStatus === "PROCESSING";

    transaction.set(requestRef, {
      ticker,
      status: isActive ? currentStatus : "QUEUED",
      requestedCount: requestedCount + 1,
      firstRequestedAt: stringFromValue(current?.firstRequestedAt) ?? nowIso,
      lastRequestedAt: nowIso,
      updatedAt: nowIso,
      completedAt: isActive ? stringFromValue(current?.completedAt) : null,
      failedAt: null,
      error: null,
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    }, { merge: true });

    return {
      ticker,
      status: isActive ? "ALREADY_QUEUED" : "QUEUED",
      message: isActive
        ? `${ticker} is already in the graph request queue. Please check back in a few minutes.`
        : `${ticker} was added to the graph request queue.`,
    };
  });
}

export async function listCompanyGraphRequests(): Promise<CompanyGraphRequestListItem[]> {
  const snapshot = await getAdminFirestore().collection("company_research_requests").limit(100).get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const item: CompanyGraphRequestListItem = {
        id: doc.id,
        ticker: stringFromValue(data.ticker) ?? doc.id,
        status: readStatus(data.status),
        requestedCount: Math.max(1, numberFromValue(data.requestedCount)),
        firstRequestedAt: firstRequestTimestampFromData(data),
        lastRequestedAt: requestTimestampFromData(data),
        updatedAt: stringFromValue(data.updatedAt) ?? "",
        completedAt: stringFromValue(data.completedAt),
        failedAt: stringFromValue(data.failedAt),
        error: stringFromValue(data.error),
        extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
        edgeCount: numberFromValue(data.edgeCount),
        processingStartedAt: stringFromValue(data.processingStartedAt),
        processingRunId: stringFromValue(data.processingRunId),
        attemptCount: numberFromValue(data.attemptCount),
      };
      return item;
    })
    .sort((left, right) => {
      const statusOrder: Record<CompanyGraphRequestStatus, number> = {
        PROCESSING: 0,
        QUEUED: 1,
        FAILED: 2,
        COMPLETED: 3,
      };
      const statusDelta = statusOrder[left.status] - statusOrder[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return (right.lastRequestedAt || right.updatedAt).localeCompare(left.lastRequestedAt || left.updatedAt);
    });
}

export async function listQueuedCompanyGraphRequests(limit: number): Promise<CompanyGraphRequestListItem[]> {
  const snapshot = await getAdminFirestore()
    .collection("company_research_requests")
    .where("status", "==", "QUEUED")
    .orderBy("firstRequestedAt", "asc")
    .limit(Math.max(1, Math.min(25, Math.trunc(limit))))
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      ticker: stringFromValue(data.ticker) ?? doc.id,
      status: readStatus(data.status),
      requestedCount: Math.max(1, numberFromValue(data.requestedCount)),
      firstRequestedAt: firstRequestTimestampFromData(data),
      lastRequestedAt: requestTimestampFromData(data),
      updatedAt: stringFromValue(data.updatedAt) ?? "",
      completedAt: stringFromValue(data.completedAt),
      failedAt: stringFromValue(data.failedAt),
      error: stringFromValue(data.error),
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
      edgeCount: numberFromValue(data.edgeCount),
      processingStartedAt: stringFromValue(data.processingStartedAt),
      processingRunId: stringFromValue(data.processingRunId),
      attemptCount: numberFromValue(data.attemptCount),
    };
  });
}

export async function claimCompanyGraphRequest(
  ticker: string,
  processingRunId: string,
): Promise<CompanyGraphRequestListItem | null> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return null;
  }

  const db = getAdminFirestore();
  const requestRef = db.collection("company_research_requests").doc(normalizedTicker);
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const status = readStatus(data?.status);

    if (!snapshot.exists || status !== "QUEUED") {
      return null;
    }

    transaction.set(requestRef, {
      ticker: normalizedTicker,
      status: "PROCESSING",
      processingRunId,
      processingStartedAt: nowIso,
      updatedAt: nowIso,
      error: null,
      attemptCount: FieldValue.increment(1),
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    }, { merge: true });

    return {
      id: snapshot.id,
      ticker: normalizedTicker,
      status: "PROCESSING",
      requestedCount: Math.max(1, numberFromValue(data?.requestedCount)),
      firstRequestedAt: stringFromValue(data?.firstRequestedAt) ?? "",
      lastRequestedAt: stringFromValue(data?.lastRequestedAt) ?? "",
      updatedAt: nowIso,
      completedAt: stringFromValue(data?.completedAt),
      failedAt: stringFromValue(data?.failedAt),
      error: null,
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
      edgeCount: numberFromValue(data?.edgeCount),
      processingStartedAt: nowIso,
      processingRunId,
      attemptCount: numberFromValue(data?.attemptCount) + 1,
    };
  });
}

export async function markCompanyGraphRequestProcessing(ticker: string): Promise<void> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return;
  }

  const db = getAdminFirestore();
  const requestRef = db.collection("company_research_requests").doc(normalizedTicker);
  const nowIso = new Date().toISOString();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const requestedCount = numberFromValue(data?.requestedCount);

    transaction.set(requestRef, {
      ticker: normalizedTicker,
      status: "PROCESSING",
      requestedCount: requestedCount + 1,
      firstRequestedAt: stringFromValue(data?.firstRequestedAt) ?? nowIso,
      lastRequestedAt: nowIso,
      updatedAt: nowIso,
      error: null,
      extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    }, { merge: true });
  });
}

export async function markCompanyGraphRequestCompleted(ticker: string, edgeCount: number): Promise<void> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return;
  }

  const nowIso = new Date().toISOString();
  await getAdminFirestore().collection("company_research_requests").doc(normalizedTicker).set({
    ticker: normalizedTicker,
    status: "COMPLETED",
    edgeCount,
    completedAt: nowIso,
    updatedAt: nowIso,
    error: null,
    extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
  }, { merge: true });
}

export async function markCompanyGraphRequestFailed(ticker: string, error: string): Promise<void> {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return;
  }

  const nowIso = new Date().toISOString();
  await getAdminFirestore().collection("company_research_requests").doc(normalizedTicker).set({
    ticker: normalizedTicker,
    status: "FAILED",
    failedAt: nowIso,
    updatedAt: nowIso,
    error,
    extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    failureCount: FieldValue.increment(1),
  }, { merge: true });
}
