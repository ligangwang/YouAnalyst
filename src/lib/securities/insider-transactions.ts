import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";

const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives";
const DISCOVERY_BATCH_SIZE = 450;
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_FILINGS = 50;
const MAX_FILINGS = 500;
const DEFAULT_TRANSACTION_CODES = ["P", "S"];

type InsiderForm = "4" | "4/A";

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
};

export type SyncInsiderTransactionsResult = {
  dryRun: boolean;
  datesRequested: string[];
  indexErrors: InsiderIndexError[];
  filingsFound: number;
  filingsProcessed: number;
  filingsSkipped: number;
  filingsFailed: number;
  transactionsParsed: number;
  transactionsWritten: number;
  transactionCodes: string[];
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
      pricePerShare,
      valueUsd: pricePerShare === null ? null : Math.round(shares * pricePerShare),
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

async function markProcessing(filing: SecMasterIndexRow, updatedAt: string): Promise<void> {
  const db = getAdminFirestore();
  await db.collection("sec_insider_filings").doc(filing.accessionNumber).set({
    accessionNumber: filing.accessionNumber,
    filingDate: filing.filingDate,
    filingUrl: filing.filingUrl,
    filename: filing.filename,
    form: filing.form,
    indexCik: filing.indexCik,
    indexCompanyName: filing.indexCompanyName,
    status: "PROCESSING",
    attempts: FieldValue.increment(1),
    processingStartedAt: updatedAt,
    updatedAt,
    source: "sec-daily-master-index",
  }, { merge: true });
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

async function isAlreadyParsed(accessionNumber: string): Promise<boolean> {
  const doc = await getAdminFirestore().collection("sec_insider_filings").doc(accessionNumber).get();
  return doc.get("status") === "PARSED";
}

async function discoverFilings(date: string, maxFilings: number): Promise<SecMasterIndexRow[]> {
  const indexText = await fetchSecText(dailyMasterIndexUrl(date));
  return parseMasterIndex(indexText).slice(0, maxFilings);
}

export async function syncInsiderTransactions(input: SyncInsiderTransactionsInput = {}): Promise<SyncInsiderTransactionsResult> {
  const dates = normalizeDates(input);
  const maxFilings = clampInteger(input.maxFilings, DEFAULT_MAX_FILINGS, 1, MAX_FILINGS);
  const transactionCodes = normalizeTransactionCodes(input.transactionCodes);
  const transactionCodeSet = new Set(transactionCodes);
  const dryRun = input.dryRun === true;
  const reprocessExisting = input.reprocessExisting === true;
  const updatedAt = new Date().toISOString();
  const items: SyncInsiderTransactionsItemResult[] = [];
  const indexErrors: InsiderIndexError[] = [];
  let filingsFound = 0;
  let filingsProcessed = 0;
  let filingsSkipped = 0;
  let filingsFailed = 0;
  let transactionsParsed = 0;
  let transactionsWritten = 0;

  for (const date of dates) {
    let filings: SecMasterIndexRow[] = [];
    try {
      filings = await discoverFilings(date, maxFilings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      indexErrors.push({ date, error: message });
      console.warn("[insider-transactions] Failed to discover SEC index", { date, error: message });
      continue;
    }

    filingsFound += filings.length;

    for (const filing of filings) {
      try {
        if (!dryRun && !reprocessExisting && await isAlreadyParsed(filing.accessionNumber)) {
          filingsSkipped += 1;
          items.push({
            accessionNumber: filing.accessionNumber,
            form: filing.form,
            filingDate: filing.filingDate,
            issuerCik: null,
            issuerName: null,
            ticker: null,
            transactionsParsed: 0,
            transactionsWritten: 0,
            skipped: true,
            error: null,
          });
          continue;
        }

        if (!dryRun) {
          await markProcessing(filing, updatedAt);
        }

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
        });
      }
    }
  }

  return {
    dryRun,
    datesRequested: dates,
    indexErrors,
    filingsFound,
    filingsProcessed,
    filingsSkipped,
    filingsFailed,
    transactionsParsed,
    transactionsWritten,
    transactionCodes,
    items,
    updatedAt,
  };
}
