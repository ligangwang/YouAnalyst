import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { Latest13FFiling, parseAndPersist13FFiling, Sync13FManagerResult } from "@/lib/securities/thirteen-f";

const SEC_BASE_URL = "https://www.sec.gov";
const DEFAULT_QUEUE_LIMIT = 10;
const MAX_QUEUE_LIMIT = 100;
const DEFAULT_STALE_PROCESSING_MINUTES = 60;

type Queued13FFilingDocument = {
  accessionNumber?: unknown;
  managerCik?: unknown;
  managerName?: unknown;
  form?: unknown;
  filingDate?: unknown;
  filingUrl?: unknown;
  filename?: unknown;
  status?: unknown;
  attempts?: unknown;
  processingStartedAt?: unknown;
};

type Claimed13FFiling = {
  id: string;
  accessionNumber: string;
  managerCik: string;
  managerName: string;
  form: "13F-HR" | "13F-HR/A";
  filingDate: string;
  filingUrl: string;
  filename: string;
};

export type Process13FQueueInput = {
  limit?: number;
  dryRun?: boolean;
  includeStaleProcessing?: boolean;
  staleProcessingMinutes?: number;
};

export type Process13FQueueItemResult = Sync13FManagerResult & {
  status: "PARSED" | "FAILED" | "DRY_RUN" | "SKIPPED";
  processingRunId: string | null;
};

export type Process13FQueueResult = {
  dryRun: boolean;
  requestedLimit: number;
  candidatesFound: number;
  processed: number;
  parsed: number;
  failed: number;
  skipped: number;
  items: Process13FQueueItemResult[];
  processingRunId: string;
  updatedAt: string;
};

function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (userAgent) {
    return userAgent;
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://youanalyst.com";
  return `YouAnalyst 13F queue worker ${appUrl}`;
}

async function fetchSecText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "application/xml,text/xml,text/plain,*/*",
      "user-agent": getSecUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC filing request failed (${response.status}): ${url}`);
  }

  return response.text();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readForm(value: unknown): "13F-HR" | "13F-HR/A" | null {
  return value === "13F-HR" || value === "13F-HR/A" ? value : null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function unpadCik(cik: string): string {
  return String(Number(cik));
}

function filingBaseUrl(cik: string, accessionNumber: string): string {
  return `${SEC_BASE_URL}/Archives/edgar/data/${unpadCik(cik)}/${accessionNumber.replace(/-/g, "")}`;
}

function normalizeQueueDocument(id: string, data: Queued13FFilingDocument): Claimed13FFiling | null {
  const accessionNumber = readString(data.accessionNumber) ?? id;
  const managerCik = readString(data.managerCik);
  const managerName = readString(data.managerName);
  const form = readForm(data.form);
  const filingDate = readString(data.filingDate);
  const filingUrl = readString(data.filingUrl);
  const filename = readString(data.filename);

  if (!accessionNumber || !managerCik || !managerName || !form || !filingDate || !filingUrl || !filename) {
    return null;
  }

  return {
    id,
    accessionNumber,
    managerCik,
    managerName,
    form,
    filingDate,
    filingUrl,
    filename,
  };
}

function normalizeReportDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return trimmed;
  }

  const monthFirst = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (monthFirst) {
    return `${monthFirst[3]}-${monthFirst[1]}-${monthFirst[2]}`;
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  return null;
}

function readXmlTag(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, "i");
  const match = pattern.exec(xml);
  return match?.[1]?.replace(/<[^>]+>/g, " ").trim() ?? null;
}

function extractReportDate(completeSubmission: string): string {
  const reportDate = normalizeReportDate(
    readXmlTag(completeSubmission, "periodOfReport") ??
    readXmlTag(completeSubmission, "reportCalendarOrQuarter"),
  );

  if (!reportDate) {
    throw new Error("Unable to read 13F report date from SEC filing.");
  }

  return reportDate;
}

async function buildLatest13FFilingFromQueue(filing: Claimed13FFiling): Promise<Latest13FFiling> {
  const completeSubmission = await fetchSecText(filing.filingUrl);
  const reportDate = extractReportDate(completeSubmission);
  const directoryUrl = `${filingBaseUrl(filing.managerCik, filing.accessionNumber)}/index.json`;

  return {
    managerCik: filing.managerCik,
    managerName: filing.managerName,
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    reportDate,
    primaryDocument: "",
    filingUrl: filing.filingUrl,
    directoryUrl,
  };
}

function processingRunId(): string {
  return `13f_queue_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function staleProcessingCutoff(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function listQueueCandidates(input: {
  limit: number;
  includeStaleProcessing: boolean;
  staleProcessingMinutes: number;
}): Promise<Array<{ id: string; data: Queued13FFilingDocument }>> {
  const db = getAdminFirestore();
  const candidates = new Map<string, { id: string; data: Queued13FFilingDocument }>();
  const discovered = await db
    .collection("sec_13f_filings")
    .where("status", "==", "DISCOVERED")
    .orderBy("filingDate", "asc")
    .orderBy("discoveredAt", "asc")
    .limit(input.limit)
    .get();

  for (const doc of discovered.docs) {
    candidates.set(doc.id, { id: doc.id, data: doc.data() as Queued13FFilingDocument });
  }

  if (input.includeStaleProcessing && candidates.size < input.limit) {
    const stale = await db
      .collection("sec_13f_filings")
      .where("status", "==", "PROCESSING")
      .where("processingStartedAt", "<=", staleProcessingCutoff(input.staleProcessingMinutes))
      .orderBy("processingStartedAt", "asc")
      .limit(input.limit - candidates.size)
      .get();

    for (const doc of stale.docs) {
      candidates.set(doc.id, { id: doc.id, data: doc.data() as Queued13FFilingDocument });
    }
  }

  return [...candidates.values()].slice(0, input.limit);
}

async function claimQueuedFiling(input: {
  id: string;
  runId: string;
  updatedAt: string;
  staleProcessingMinutes: number;
}): Promise<Claimed13FFiling | null> {
  const db = getAdminFirestore();
  const ref = db.collection("sec_13f_filings").doc(input.id);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as Queued13FFilingDocument;
    const status = readString(data.status);
    const processingStartedAt = readString(data.processingStartedAt);
    const isStaleProcessing = status === "PROCESSING" &&
      (!processingStartedAt || processingStartedAt <= staleProcessingCutoff(input.staleProcessingMinutes));

    if (status !== "DISCOVERED" && !isStaleProcessing) {
      return null;
    }

    const filing = normalizeQueueDocument(snapshot.id, data);
    if (!filing) {
      transaction.set(ref, {
        status: "SKIPPED",
        lastError: "Queued 13F filing is missing required metadata.",
        skippedAt: input.updatedAt,
        updatedAt: input.updatedAt,
      }, { merge: true });
      return null;
    }

    transaction.set(ref, {
      status: "PROCESSING",
      processingRunId: input.runId,
      processingStartedAt: input.updatedAt,
      lastAttemptAt: input.updatedAt,
      attempts: FieldValue.increment(1),
      updatedAt: input.updatedAt,
    }, { merge: true });

    return filing;
  });
}

async function markQueuedFilingParsed(input: {
  accessionNumber: string;
  result: Sync13FManagerResult;
  updatedAt: string;
}): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_13f_filings").doc(input.accessionNumber).set({
    status: "PARSED",
    canonicalStatus: "UNKNOWN",
    reportDate: input.result.reportDate,
    quarter: input.result.quarter,
    infoTableUrl: input.result.infoTableUrl,
    holdingsParsed: input.result.holdingsParsed,
    holdingsMapped: input.result.holdingsMapped,
    holdingsWritten: input.result.holdingsWritten,
    changesWritten: input.result.changesWritten,
    lastError: null,
    processedAt: input.updatedAt,
    updatedAt: input.updatedAt,
  }, { merge: true });
}

async function markQueuedFilingFailed(input: {
  accessionNumber: string;
  error: string;
  updatedAt: string;
}): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_13f_filings").doc(input.accessionNumber).set({
    status: "FAILED",
    lastError: input.error,
    failedAt: input.updatedAt,
    updatedAt: input.updatedAt,
  }, { merge: true });
}

async function markQueuedFilingSkipped(input: {
  accessionNumber: string;
  reason: string;
  updatedAt: string;
}): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_13f_filings").doc(input.accessionNumber).set({
    status: "SKIPPED",
    lastError: input.reason,
    skippedAt: input.updatedAt,
    updatedAt: input.updatedAt,
  }, { merge: true });
}

function failedItem(filing: Claimed13FFiling, error: unknown, runId: string): Process13FQueueItemResult {
  return {
    managerCik: filing.managerCik,
    managerName: filing.managerName,
    accessionNumber: filing.accessionNumber,
    reportDate: null,
    quarter: null,
    infoTableUrl: null,
    holdingsParsed: 0,
    holdingsMapped: 0,
    holdingsWritten: 0,
    changesWritten: 0,
    skipped: false,
    error: error instanceof Error ? error.message : "Failed to process queued 13F filing",
    status: "FAILED",
    processingRunId: runId,
  };
}

export async function process13FQueue(input: Process13FQueueInput): Promise<Process13FQueueResult> {
  const limit = clampInteger(input.limit, DEFAULT_QUEUE_LIMIT, 1, MAX_QUEUE_LIMIT);
  const dryRun = input.dryRun === true;
  const includeStaleProcessing = input.includeStaleProcessing !== false;
  const staleProcessingMinutes = clampInteger(input.staleProcessingMinutes, DEFAULT_STALE_PROCESSING_MINUTES, 5, 24 * 60);
  const updatedAt = new Date().toISOString();
  const runId = processingRunId();
  const candidates = await listQueueCandidates({
    limit,
    includeStaleProcessing,
    staleProcessingMinutes,
  });
  const items: Process13FQueueItemResult[] = [];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeQueueDocument(candidate.id, candidate.data);
    if (!normalizedCandidate) {
      items.push({
        managerCik: candidate.id,
        managerName: candidate.id,
        accessionNumber: candidate.id,
        reportDate: null,
        quarter: null,
        infoTableUrl: null,
        holdingsParsed: 0,
        holdingsMapped: 0,
        holdingsWritten: 0,
        changesWritten: 0,
        skipped: true,
        error: "Queued 13F filing is missing required metadata.",
        status: "SKIPPED",
        processingRunId: dryRun ? null : runId,
      });
      continue;
    }

    const filing = dryRun
      ? normalizedCandidate
      : await claimQueuedFiling({
        id: candidate.id,
        runId,
        updatedAt,
        staleProcessingMinutes,
      });

    if (!filing) {
      continue;
    }

    if (filing.form === "13F-HR/A") {
      const reason = "13F amendments are deferred until canonical amendment handling is enabled.";
      items.push({
        managerCik: filing.managerCik,
        managerName: filing.managerName,
        accessionNumber: filing.accessionNumber,
        reportDate: null,
        quarter: null,
        infoTableUrl: null,
        holdingsParsed: 0,
        holdingsMapped: 0,
        holdingsWritten: 0,
        changesWritten: 0,
        skipped: true,
        error: reason,
        status: "SKIPPED",
        processingRunId: dryRun ? null : runId,
      });

      if (!dryRun) {
        await markQueuedFilingSkipped({
          accessionNumber: filing.accessionNumber,
          reason,
          updatedAt,
        });
      }
      continue;
    }

    try {
      const secFiling = await buildLatest13FFilingFromQueue(filing);
      const result = await parseAndPersist13FFiling({
        filing: secFiling,
        dryRun,
        updatedAt,
      });
      const item: Process13FQueueItemResult = {
        ...result,
        status: dryRun ? "DRY_RUN" : "PARSED",
        processingRunId: dryRun ? null : runId,
      };

      items.push(item);
      if (!dryRun) {
        await markQueuedFilingParsed({
          accessionNumber: filing.accessionNumber,
          result,
          updatedAt,
        });
      }
    } catch (error) {
      const item = failedItem(filing, error, runId);
      items.push(item);
      if (!dryRun) {
        await markQueuedFilingFailed({
          accessionNumber: filing.accessionNumber,
          error: item.error ?? "Failed to process queued 13F filing",
          updatedAt,
        });
      }
    }
  }

  return {
    dryRun,
    requestedLimit: limit,
    candidatesFound: candidates.length,
    processed: items.length,
    parsed: items.filter((item) => item.status === "PARSED" || item.status === "DRY_RUN").length,
    failed: items.filter((item) => item.status === "FAILED").length,
    skipped: items.filter((item) => item.status === "SKIPPED").length,
    items,
    processingRunId: runId,
    updatedAt,
  };
}
