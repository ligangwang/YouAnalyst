import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { normalizeInsiderTransactionAmounts } from "@/lib/securities/insider-transaction-values";

const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives";
const DISCOVERY_BATCH_SIZE = 450;
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_FILINGS = 50;
const MAX_FILINGS = 500;
const DEFAULT_TRANSACTION_CODES = ["P", "S"];
const DEFAULT_STALE_PROCESSING_MINUTES = 60;

type InsiderForm = "4" | "4/A";
type InsiderFilingStatus = "DISCOVERED" | "PROCESSING" | "PARSED" | "FAILED" | "SKIPPED";

type SecMasterIndexRow = {
  accessionNumber: string;
  filingDate: string;
  filingUrl: string;
  filename: string;
  form: InsiderForm;
  indexCik: string;
  indexCompanyName: string;
};

type InsiderIndexError = {
  date: string;
  error: string;
};

type QueuedInsiderFilingDocument = {
  accessionNumber?: unknown;
  filingDate?: unknown;
  filingUrl?: unknown;
  filename?: unknown;
  form?: unknown;
  indexCik?: unknown;
  indexCompanyName?: unknown;
  status?: unknown;
  processingStartedAt?: unknown;
};

type ReportingOwnerRelationship = {
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
  officerTitle: string | null;
  otherText: string | null;
};

export type InsiderTransaction = {
  accessionNumber: string;
  transactionIndex: number;
  filingDate: string;
  form: InsiderForm;
  issuerCik: string;
  issuerName: string;
  ticker: string | null;
  reportingOwnerCik: string;
  reportingOwnerName: string;
  relationship: ReportingOwnerRelationship;
  securityTitle: string;
  transactionDate: string;
  transactionCode: string;
  acquiredDisposedCode: "A" | "D" | null;
  shares: number;
  pricePerShare: number | null;
  valueUsd: number | null;
  sharesOwnedFollowing: number | null;
  directOrIndirectOwnership: "D" | "I" | null;
  ownershipNature: string | null;
  source: "sec-form4";
  updatedAt: string;
};

export type SyncInsiderTransactionsInput = {
  date?: string;
  dates?: string[];
  lookbackDays?: number;
  maxFilings?: number;
  transactionCodes?: string[];
  dryRun?: boolean;
  reprocessExisting?: boolean;
  includeStaleProcessing?: boolean;
  staleProcessingMinutes?: number;
  processOnly?: boolean;
  discoverOnly?: boolean;
};

export type SyncInsiderTransactionsItemResult = {
  accessionNumber: string;
  form: InsiderForm;
  filingDate: string;
  issuerCik: string | null;
  issuerName: string | null;
  ticker: string | null;
  transactionsParsed: number;
  transactionsWritten: number;
  skipped: boolean;
  error: string | null;
  status: InsiderFilingStatus | "DRY_RUN";
};

export type SyncInsiderTransactionsResult = {
  dryRun: boolean;
  datesRequested: string[];
  indexErrors: InsiderIndexError[];
  filingsFound: number;
  filingsQueued: number;
  filingsExisting: number;
  candidatesFound: number;
  filingsProcessed: number;
  filingsSkipped: number;
  filingsFailed: number;
  transactionsParsed: number;
  transactionsWritten: number;
  transactionCodes: string[];
  processingRunId: string;
  items: SyncInsiderTransactionsItemResult[];
  updatedAt: string;
};

function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (userAgent) {
    return userAgent;
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://youanalyst.com";
  return `YouAnalyst insider transactions ${appUrl}`;
}

async function fetchSecText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "application/xml,text/xml,text/plain,*/*",
      "user-agent": getSecUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC insider filing request failed (${response.status}): ${url}`);
  }

  return response.text();
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatIsoDateOrThrow(value: string): string {
  const date = parseIsoDate(value);
  if (!date) {
    throw new Error(`Invalid SEC index date "${value}". Expected YYYY-MM-DD.`);
  }

  return formatIsoDate(date);
}

function normalizeIndexDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  return parseIsoDate(value) ? value : null;
}

function normalizeDates(input: SyncInsiderTransactionsInput): string[] {
  if (Array.isArray(input.dates) && input.dates.length > 0) {
    return [...new Set(input.dates.map((date) => formatIsoDateOrThrow(date)))];
  }

  if (input.date) {
    return [formatIsoDateOrThrow(input.date)];
  }

  const lookbackDays = clampInteger(input.lookbackDays, DEFAULT_LOOKBACK_DAYS, 1, MAX_LOOKBACK_DAYS);
  const dates: string[] = [];
  const today = new Date();

  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    dates.push(formatIsoDate(date));
  }

  return dates;
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function quarterFromDate(date: string): number {
  const parsed = parseIsoDate(date);
  if (!parsed) {
    throw new Error(`Invalid SEC index date "${date}". Expected YYYY-MM-DD.`);
  }

  return Math.floor(parsed.getUTCMonth() / 3) + 1;
}

function dailyMasterIndexUrl(date: string): string {
  const year = date.slice(0, 4);
  return `${SEC_ARCHIVES_BASE_URL}/edgar/daily-index/${year}/QTR${quarterFromDate(date)}/master.${compactDate(date)}.idx`;
}

function padCik(value: string): string {
  return value.replace(/\D/g, "").padStart(10, "0");
}

function normalizeCik(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits && digits.length <= 10 ? digits.padStart(10, "0") : null;
}

function accessionFromFilename(filename: string): string | null {
  const lastSegment = filename.split("/").pop() ?? "";
  const accession = lastSegment.replace(/\.txt$/i, "");
  return /^\d{10}-\d{2}-\d{6}$/.test(accession) ? accession : null;
}

function normalizeTransactionCodes(values: string[] | undefined): string[] {
  const candidates = Array.isArray(values) && values.length > 0 ? values : DEFAULT_TRANSACTION_CODES;
  const codes = candidates
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z0-9]{1,2}$/.test(value));

  return [...new Set(codes.length > 0 ? codes : DEFAULT_TRANSACTION_CODES)];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readInsiderForm(value: unknown): InsiderForm | null {
  return value === "4" || value === "4/A" ? value : null;
}

function normalizeQueueDocument(id: string, data: QueuedInsiderFilingDocument): SecMasterIndexRow | null {
  const accessionNumber = readString(data.accessionNumber) ?? id;
  const filingDate = readString(data.filingDate);
  const filingUrl = readString(data.filingUrl);
  const filename = readString(data.filename);
  const form = readInsiderForm(data.form);
  const indexCik = readString(data.indexCik);
  const indexCompanyName = readString(data.indexCompanyName);

  if (!accessionNumber || !filingDate || !filingUrl || !filename || !form || !indexCik || !indexCompanyName) {
    return null;
  }

  return {
    accessionNumber,
    filingDate,
    filingUrl,
    filename,
    form,
    indexCik,
    indexCompanyName,
  };
}

function parseMasterIndex(text: string): SecMasterIndexRow[] {
  const rows: SecMasterIndexRow[] = [];
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => (
    line.startsWith("CIK|Company Name|Form Type|Date Filed|Filename") ||
    line.startsWith("CIK|Company Name|Form Type|Date Filed|File Name")
  ));

  if (startIndex < 0) {
    throw new Error("SEC master index header was not found.");
  }

  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [cik, indexCompanyName, form, rawFilingDate, filename] = trimmed.split("|");
    const filingDate = normalizeIndexDate(rawFilingDate);
    if ((form !== "4" && form !== "4/A") || !cik || !indexCompanyName || !filingDate || !filename) {
      continue;
    }

    const accessionNumber = accessionFromFilename(filename);
    if (!accessionNumber) {
      continue;
    }

    rows.push({
      accessionNumber,
      filingDate,
      filingUrl: `${SEC_ARCHIVES_BASE_URL}/${filename}`,
      filename,
      form,
      indexCik: padCik(cik),
      indexCompanyName: indexCompanyName.trim(),
    });
  }

  return rows;
}

function tagText(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, "i");
  const match = pattern.exec(xml);
  const value = match?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return value || null;
}

function tagBlocks(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tagName}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[0]);
}

function nestedValue(xml: string, tagName: string): string | null {
  const block = tagText(xml, tagName);
  return block ? tagText(block, "value") ?? block : null;
}

function normalizeBoolean(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function normalizeNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  return parseIsoDate(value) ? value : null;
}

function normalizeOwnershipCode(value: string | null): "D" | "I" | null {
  return value === "D" || value === "I" ? value : null;
}

function normalizeAcquiredDisposedCode(value: string | null): "A" | "D" | null {
  return value === "A" || value === "D" ? value : null;
}

function extractOwnershipDocuments(completeSubmission: string): string[] {
  const documents = tagBlocks(completeSubmission, "ownershipDocument");
  if (documents.length > 0) {
    return documents;
  }

  const xmlDocuments = [...completeSubmission.matchAll(/<XML>([\s\S]*?)<\/XML>/gi)]
    .map((match) => match[1])
    .filter((document) => /<ownershipDocument\b/i.test(document));

  return xmlDocuments.length > 0 ? xmlDocuments : [];
}

function parseOwnershipDocument(
  xml: string,
  filing: SecMasterIndexRow,
  transactionCodes: Set<string>,
  updatedAt: string,
): InsiderTransaction[] {
  const issuerBlock = tagBlocks(xml, "issuer")[0] ?? "";
  const ownerBlock = tagBlocks(xml, "reportingOwner")[0] ?? "";
  const ownerIdBlock = tagBlocks(ownerBlock, "reportingOwnerId")[0] ?? "";
  const relationshipBlock = tagBlocks(ownerBlock, "reportingOwnerRelationship")[0] ?? "";
  const issuerCik = normalizeCik(tagText(issuerBlock, "issuerCik"));
  const issuerName = tagText(issuerBlock, "issuerName");
  const reportingOwnerCik = normalizeCik(tagText(ownerIdBlock, "rptOwnerCik"));
  const reportingOwnerName = tagText(ownerIdBlock, "rptOwnerName");

  if (!issuerCik || !issuerName || !reportingOwnerCik || !reportingOwnerName) {
    throw new Error(`Unable to read issuer or reporting owner from ${filing.accessionNumber}.`);
  }

  const relationship: ReportingOwnerRelationship = {
    isDirector: normalizeBoolean(tagText(relationshipBlock, "isDirector")),
    isOfficer: normalizeBoolean(tagText(relationshipBlock, "isOfficer")),
    isTenPercentOwner: normalizeBoolean(tagText(relationshipBlock, "isTenPercentOwner")),
    isOther: normalizeBoolean(tagText(relationshipBlock, "isOther")),
    officerTitle: tagText(relationshipBlock, "officerTitle"),
    otherText: tagText(relationshipBlock, "otherText"),
  };

  const ticker = tagText(issuerBlock, "issuerTradingSymbol")?.toUpperCase() ?? null;
  const transactions: InsiderTransaction[] = [];
  const blocks = tagBlocks(xml, "nonDerivativeTransaction");

  blocks.forEach((block, index) => {
    const code = tagText(tagBlocks(block, "transactionCoding")[0] ?? block, "transactionCode")?.toUpperCase() ?? null;
    if (!code || !transactionCodes.has(code)) {
      return;
    }

    const transactionDate = normalizeDate(nestedValue(block, "transactionDate"));
    const shares = normalizeNumber(nestedValue(block, "transactionShares"));
    const pricePerShare = normalizeNumber(nestedValue(block, "transactionPricePerShare"));
    const securityTitle = nestedValue(block, "securityTitle");

    if (!transactionDate || !securityTitle || shares === null) {
      return;
    }

    const amounts = normalizeInsiderTransactionAmounts({ shares, pricePerShare });

    transactions.push({
      accessionNumber: filing.accessionNumber,
      transactionIndex: index,
      filingDate: filing.filingDate,
      form: filing.form,
      issuerCik,
      issuerName,
      ticker,
      reportingOwnerCik,
      reportingOwnerName,
      relationship,
      securityTitle,
      transactionDate,
      transactionCode: code,
      acquiredDisposedCode: normalizeAcquiredDisposedCode(nestedValue(block, "transactionAcquiredDisposedCode")),
      shares,
      pricePerShare: amounts.pricePerShare,
      valueUsd: amounts.valueUsd,
      sharesOwnedFollowing: normalizeNumber(nestedValue(block, "sharesOwnedFollowingTransaction")),
      directOrIndirectOwnership: normalizeOwnershipCode(nestedValue(block, "directOrIndirectOwnership")),
      ownershipNature: nestedValue(block, "natureOfOwnership"),
      source: "sec-form4",
      updatedAt,
    });
  });

  return transactions;
}

function transactionDocId(transaction: InsiderTransaction): string {
  return `${transaction.accessionNumber}_${String(transaction.transactionIndex).padStart(3, "0")}`;
}

async function persistTransactions(input: {
  filing: SecMasterIndexRow;
  transactions: InsiderTransaction[];
  updatedAt: string;
}): Promise<number> {
  const db = getAdminFirestore();
  let written = 0;

  for (let index = 0; index < input.transactions.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = input.transactions.slice(index, index + DISCOVERY_BATCH_SIZE);

    for (const transaction of chunk) {
      batch.set(db.collection("insider_transactions").doc(transactionDocId(transaction)), transaction, { merge: true });
    }

    await batch.commit();
    written += chunk.length;
  }

  await db.collection("sec_insider_filings").doc(input.filing.accessionNumber).set({
    accessionNumber: input.filing.accessionNumber,
    filingDate: input.filing.filingDate,
    filingUrl: input.filing.filingUrl,
    filename: input.filing.filename,
    form: input.filing.form,
    indexCik: input.filing.indexCik,
    indexCompanyName: input.filing.indexCompanyName,
    status: "PARSED",
    transactionsWritten: written,
    lastError: null,
    parsedAt: input.updatedAt,
    updatedAt: input.updatedAt,
    source: "sec-daily-master-index",
  }, { merge: true });

  return written;
}

async function persistDiscoveredFilings(input: {
  filings: SecMasterIndexRow[];
  dryRun: boolean;
  discoveredAt: string;
  reprocessExisting: boolean;
}): Promise<{ queued: number; existing: number }> {
  if (input.filings.length === 0 || input.dryRun) {
    return { queued: 0, existing: 0 };
  }

  const db = getAdminFirestore();
  let queued = 0;
  let existing = 0;

  for (let index = 0; index < input.filings.length; index += DISCOVERY_BATCH_SIZE) {
    const chunk = input.filings.slice(index, index + DISCOVERY_BATCH_SIZE);
    const refs = chunk.map((filing) => db.collection("sec_insider_filings").doc(filing.accessionNumber));
    const snapshots = await db.getAll(...refs);
    const batch = db.batch();

    chunk.forEach((filing, chunkIndex) => {
      const ref = refs[chunkIndex];
      const snapshot = snapshots[chunkIndex];
      const status = snapshot.exists ? readString(snapshot.get("status")) : null;
      const shouldRequeue = input.reprocessExisting || !snapshot.exists || status === "FAILED" || status === "SKIPPED";

      if (!shouldRequeue) {
        existing += 1;
        batch.set(ref, {
          lastDiscoveredAt: input.discoveredAt,
          sourceIndexFilingDate: filing.filingDate,
          updatedAt: input.discoveredAt,
        }, { merge: true });
        return;
      }

      queued += 1;
      batch.set(ref, {
        accessionNumber: filing.accessionNumber,
        filingDate: filing.filingDate,
        filingUrl: filing.filingUrl,
        filename: filing.filename,
        form: filing.form,
        indexCik: filing.indexCik,
        indexCompanyName: filing.indexCompanyName,
        status: "DISCOVERED",
        attempts: input.reprocessExisting ? 0 : snapshot.exists ? snapshot.get("attempts") ?? 0 : 0,
        lastError: null,
        discoveredAt: snapshot.exists ? snapshot.get("discoveredAt") ?? input.discoveredAt : input.discoveredAt,
        lastDiscoveredAt: input.discoveredAt,
        sourceIndexFilingDate: filing.filingDate,
        source: "sec-daily-master-index",
        updatedAt: input.discoveredAt,
      }, { merge: true });
    });

    await batch.commit();
  }

  return { queued, existing };
}

async function markFailed(filing: SecMasterIndexRow, updatedAt: string, error: string): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_insider_filings").doc(filing.accessionNumber).set({
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    filingUrl: filing.filingUrl,
    filename: filing.filename,
    form: filing.form,
    indexCik: filing.indexCik,
    indexCompanyName: filing.indexCompanyName,
    status: "FAILED",
    lastError: error,
    failedAt: updatedAt,
    updatedAt,
    source: "sec-daily-master-index",
  }, { merge: true });
}

async function markInvalidQueuedFilingSkipped(id: string, updatedAt: string, error: string): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_insider_filings").doc(id).set({
    status: "SKIPPED",
    lastError: error,
    skippedAt: updatedAt,
    updatedAt,
  }, { merge: true });
}

async function discoverFilings(date: string): Promise<SecMasterIndexRow[]> {
  const indexText = await fetchSecText(dailyMasterIndexUrl(date));
  return parseMasterIndex(indexText);
}

function processingRunId(): string {
  return `insider_queue_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function staleProcessingCutoff(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function listQueueCandidates(input: {
  limit: number;
  includeStaleProcessing: boolean;
  staleProcessingMinutes: number;
}): Promise<Array<{ id: string; data: QueuedInsiderFilingDocument }>> {
  const db = getAdminFirestore();
  const candidates = new Map<string, { id: string; data: QueuedInsiderFilingDocument }>();
  const discovered = await db
    .collection("sec_insider_filings")
    .where("status", "==", "DISCOVERED")
    .orderBy("filingDate", "asc")
    .orderBy("discoveredAt", "asc")
    .limit(input.limit)
    .get();

  for (const doc of discovered.docs) {
    candidates.set(doc.id, { id: doc.id, data: doc.data() as QueuedInsiderFilingDocument });
  }

  if (input.includeStaleProcessing && candidates.size < input.limit) {
    const stale = await db
      .collection("sec_insider_filings")
      .where("status", "==", "PROCESSING")
      .where("processingStartedAt", "<=", staleProcessingCutoff(input.staleProcessingMinutes))
      .orderBy("processingStartedAt", "asc")
      .limit(input.limit - candidates.size)
      .get();

    for (const doc of stale.docs) {
      candidates.set(doc.id, { id: doc.id, data: doc.data() as QueuedInsiderFilingDocument });
    }
  }

  return [...candidates.values()].slice(0, input.limit);
}

async function claimQueuedFiling(input: {
  id: string;
  updatedAt: string;
  processingRunId: string;
  staleProcessingMinutes: number;
}): Promise<SecMasterIndexRow | null> {
  const db = getAdminFirestore();
  const ref = db.collection("sec_insider_filings").doc(input.id);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as QueuedInsiderFilingDocument;
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
        lastError: "Queued insider filing is missing required metadata.",
        skippedAt: input.updatedAt,
        updatedAt: input.updatedAt,
      }, { merge: true });
      return null;
    }

    transaction.set(ref, {
      status: "PROCESSING",
      processingRunId: input.processingRunId,
      processingStartedAt: input.updatedAt,
      lastAttemptAt: input.updatedAt,
      attempts: FieldValue.increment(1),
      updatedAt: input.updatedAt,
    }, { merge: true });

    return filing;
  });
}

export async function syncInsiderTransactions(input: SyncInsiderTransactionsInput = {}): Promise<SyncInsiderTransactionsResult> {
  const processOnly = input.processOnly === true;
  const discoverOnly = input.discoverOnly === true;
  const dates = processOnly ? [] : normalizeDates(input);
  const maxFilings = clampInteger(input.maxFilings, DEFAULT_MAX_FILINGS, 1, MAX_FILINGS);
  const transactionCodes = normalizeTransactionCodes(input.transactionCodes);
  const transactionCodeSet = new Set(transactionCodes);
  const dryRun = input.dryRun === true;
  const reprocessExisting = input.reprocessExisting === true;
  const includeStaleProcessing = input.includeStaleProcessing !== false;
  const staleProcessingMinutes = clampInteger(input.staleProcessingMinutes, DEFAULT_STALE_PROCESSING_MINUTES, 5, 24 * 60);
  const updatedAt = new Date().toISOString();
  const runId = processingRunId();
  const items: SyncInsiderTransactionsItemResult[] = [];
  const indexErrors: InsiderIndexError[] = [];
  const dryRunFilings: SecMasterIndexRow[] = [];
  let filingsFound = 0;
  let filingsQueued = 0;
  let filingsExisting = 0;
  let filingsProcessed = 0;
  let filingsSkipped = 0;
  let filingsFailed = 0;
  let transactionsParsed = 0;
  let transactionsWritten = 0;

  if (!processOnly) {
    for (const date of dates) {
      let filings: SecMasterIndexRow[] = [];
      try {
        filings = await discoverFilings(date);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        indexErrors.push({ date, error: message });
        console.warn("[insider-transactions] Failed to discover SEC index", { date, error: message });
        continue;
      }

      filingsFound += filings.length;
      dryRunFilings.push(...filings);

      const persisted = await persistDiscoveredFilings({
        filings,
        dryRun,
        discoveredAt: updatedAt,
        reprocessExisting,
      });
      filingsQueued += persisted.queued;
      filingsExisting += persisted.existing;
    }
  }

  const queueCandidates = discoverOnly || (dryRun && !processOnly)
    ? []
    : await listQueueCandidates({
        limit: maxFilings,
        includeStaleProcessing,
        staleProcessingMinutes,
      });
  const candidates = discoverOnly
    ? []
    : dryRun && !processOnly
    ? dryRunFilings.slice(0, maxFilings).map((filing) => ({ id: filing.accessionNumber, filing }))
    : queueCandidates.map((candidate) => ({
        id: candidate.id,
        filing: normalizeQueueDocument(candidate.id, candidate.data),
      }));

  for (const candidate of candidates) {
    if (!candidate.filing) {
      filingsSkipped += 1;
      items.push({
        accessionNumber: candidate.id,
        form: "4",
        filingDate: "",
        issuerCik: null,
        issuerName: null,
        ticker: null,
        transactionsParsed: 0,
        transactionsWritten: 0,
        skipped: true,
        error: "Queued insider filing is missing required metadata.",
        status: "SKIPPED",
      });

      if (!dryRun) {
        await markInvalidQueuedFilingSkipped(candidate.id, updatedAt, "Queued insider filing is missing required metadata.");
      }
      continue;
    }

    const filing = dryRun
      ? candidate.filing
      : await claimQueuedFiling({
          id: candidate.id,
          updatedAt,
          processingRunId: runId,
          staleProcessingMinutes,
        });

    if (!filing) {
      continue;
    }

    try {
      const completeSubmission = await fetchSecText(filing.filingUrl);
      const documents = extractOwnershipDocuments(completeSubmission);
      if (documents.length === 0) {
        throw new Error(`No ownershipDocument XML found for accession ${filing.accessionNumber}.`);
      }

      const transactions = documents.flatMap((document) => parseOwnershipDocument(document, filing, transactionCodeSet, updatedAt));
      const written = dryRun ? 0 : await persistTransactions({ filing, transactions, updatedAt });
      const firstTransaction = transactions[0] ?? null;

      filingsProcessed += 1;
      transactionsParsed += transactions.length;
      transactionsWritten += written;
      items.push({
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        filingDate: filing.filingDate,
        issuerCik: firstTransaction?.issuerCik ?? null,
        issuerName: firstTransaction?.issuerName ?? null,
        ticker: firstTransaction?.ticker ?? null,
        transactionsParsed: transactions.length,
        transactionsWritten: written,
        skipped: false,
        error: null,
        status: dryRun ? "DRY_RUN" : "PARSED",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      filingsFailed += 1;
      if (!dryRun) {
        await markFailed(filing, updatedAt, message);
      }
      items.push({
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        filingDate: filing.filingDate,
        issuerCik: null,
        issuerName: null,
        ticker: null,
        transactionsParsed: 0,
        transactionsWritten: 0,
        skipped: false,
        error: message,
        status: "FAILED",
      });
    }
  }

  return {
    dryRun,
    datesRequested: dates,
    indexErrors,
    filingsFound,
    filingsQueued,
    filingsExisting,
    candidatesFound: candidates.length,
    filingsProcessed,
    filingsSkipped,
    filingsFailed,
    transactionsParsed,
    transactionsWritten,
    transactionCodes,
    processingRunId: runId,
    items,
    updatedAt,
  };
}
