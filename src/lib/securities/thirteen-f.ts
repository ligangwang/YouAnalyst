import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase/admin";

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_DATA_BASE_URL = "https://data.sec.gov";
const SEC_13F_RAW_GCS_PREFIX = "sec-13f/raw";
const HOLDING_BATCH_SIZE = 450;
const MAX_MANAGER_CIKS = 25;
const DOLLAR_VALUE_REPORTING_START_DATE = "2023-01-03";

export class InvalidManagerCikError extends Error {
  constructor(value: string) {
    super(`Invalid manager CIK "${value}". Manager CIKs must contain 1 to 10 digits.`);
    this.name = "InvalidManagerCikError";
  }
}

type SecSubmissionsResponse = {
  name?: unknown;
  cik?: unknown;
  filings?: {
    recent?: Record<string, unknown>;
  };
};

type SecDirectoryIndexResponse = {
  directory?: {
    item?: unknown;
  };
};

type SecDirectoryItem = {
  name?: unknown;
  type?: unknown;
  size?: unknown;
  "last-modified"?: unknown;
};

type SecurityIdMapping = {
  ticker?: unknown;
  symbol?: unknown;
  exchange?: unknown;
};

type Canonical13FFilingDocument = {
  accessionNumber?: unknown;
  filingDate?: unknown;
  form?: unknown;
  amendmentNo?: unknown;
};

type Parsed13FHolding = {
  nameOfIssuer: string;
  titleOfClass: string | null;
  cusip: string;
  valueThousands: number;
  shares: number;
  shareType: string | null;
  putCall: string | null;
  investmentDiscretion: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
};

export type Latest13FFiling = {
  managerCik: string;
  managerName: string;
  form: "13F-HR" | "13F-HR/A";
  amendmentNo: number | null;
  amendmentType: string | null;
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  filingUrl: string;
  directoryUrl: string;
};

export type InstitutionalHolding = Parsed13FHolding & {
  positionKey: string;
  quarter: string;
  managerCik: string;
  managerName: string;
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  infoTableUrl: string;
  ticker: string | null;
  providerSymbol: string | null;
  exchange: string | null;
  valueUsd: number;
  source: "sec-13f";
  updatedAt: string;
};

export type InstitutionalHoldingChange = {
  quarter: string;
  managerCik: string;
  managerName: string;
  positionKey: string;
  cusip: string;
  ticker: string | null;
  nameOfIssuer: string;
  currentShares: number;
  previousShares: number;
  shareChange: number;
  percentChange: number | null;
  currentValueUsd: number;
  previousValueUsd: number;
  valueChangeUsd: number;
  status: "NEW" | "INCREASED" | "REDUCED" | "SOLD_OUT" | "UNCHANGED";
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  updatedAt: string;
};

export type Sync13FManagerResult = {
  managerCik: string;
  managerName: string;
  accessionNumber: string | null;
  reportDate: string | null;
  quarter: string | null;
  infoTableUrl: string | null;
  holdingsParsed: number;
  holdingsMapped: number;
  holdingsWritten: number;
  changesWritten: number;
  canonicalStatus: "CANONICAL" | "SUPERSEDED" | "NON_CANONICAL" | "UNKNOWN";
  skipped: boolean;
  error: string | null;
};

export type Sync13FInput = {
  managerCiks: string[];
  dryRun?: boolean;
};

export type Sync13FResult = {
  dryRun: boolean;
  requestedManagers: number;
  completedManagers: number;
  failedManagers: number;
  holdingsParsed: number;
  holdingsWritten: number;
  changesWritten: number;
  items: Sync13FManagerResult[];
  updatedAt: string;
};

function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (userAgent) {
    return userAgent;
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://youanalyst.com";
  return `YouAnalyst 13F parser ${appUrl}`;
}

function secRawGcsPath(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, "").replace(/\/+/g, "/");
    const queryDigest = parsed.search
      ? `-${createHash("sha256").update(parsed.search).digest("hex").slice(0, 12)}`
      : "";
    return `${SEC_13F_RAW_GCS_PREFIX}/${parsed.hostname}/${pathname}${queryDigest}`;
  } catch {
    const digest = createHash("sha256").update(url).digest("hex");
    return `${SEC_13F_RAW_GCS_PREFIX}/unknown/${digest}.txt`;
  }
}

async function readSecRawTextFromGcs(path: string): Promise<string | null> {
  try {
    const file = getAdminStorageBucket().file(path);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }

    const [contents] = await file.download();
    return contents.toString("utf8");
  } catch (error) {
    console.warn("[13f] Failed to read SEC raw cache; falling back to SEC", {
      error: error instanceof Error ? error.message : String(error),
      path,
    });
    return null;
  }
}

async function writeSecRawTextToGcs(path: string, contents: string, contentType: string): Promise<void> {
  try {
    const file = getAdminStorageBucket().file(path);
    await file.save(contents, {
      contentType,
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.warn("[13f] Failed to write SEC raw cache", {
      error: error instanceof Error ? error.message : String(error),
      path,
    });
  }
}

async function fetchSecRawText(
  url: string,
  input: {
    accept: string;
    cache?: boolean;
    contentType: string;
    errorPrefix: string;
  },
): Promise<string> {
  const cachePath = secRawGcsPath(url);
  if (input.cache !== false) {
    const cached = await readSecRawTextFromGcs(cachePath);
    if (cached !== null) {
      return cached;
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: input.accept,
      "user-agent": getSecUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`${input.errorPrefix} (${response.status}): ${url}`);
  }

  const text = await response.text();
  if (input.cache !== false) {
    await writeSecRawTextToGcs(cachePath, text, input.contentType);
  }
  return text;
}

async function fetchSecJson<T>(url: string, input: { cache?: boolean } = {}): Promise<T> {
  const text = await fetchSecRawText(url, {
    accept: "application/json",
    cache: input.cache,
    contentType: "application/json",
    errorPrefix: "SEC request failed",
  });

  return JSON.parse(text) as T;
}

export async function fetchSecText(url: string): Promise<string> {
  return fetchSecRawText(url, {
    accept: "application/xml,text/xml,text/plain,*/*",
    contentType: "text/plain; charset=utf-8",
    errorPrefix: "SEC download failed",
  });
}

function padCik(cik: string | number): string {
  const value = String(cik).trim();
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length > 10) {
    throw new InvalidManagerCikError(value);
  }

  return digits.padStart(10, "0");
}

function unpadCik(cik: string): string {
  return String(Number(cik));
}

function normalizeManagerCiks(values: string[]): string[] {
  const seen = new Set<string>();
  const ciks: string[] = [];

  for (const value of values) {
    const cik = padCik(value);
    if (seen.has(cik)) {
      continue;
    }

    seen.add(cik);
    ciks.push(cik);
  }

  return ciks.slice(0, MAX_MANAGER_CIKS);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecentColumn(recent: Record<string, unknown>, key: string): string[] {
  const value = recent[key];
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function filingBaseUrl(cik: string, accessionNumber: string): string {
  return `${SEC_BASE_URL}/Archives/edgar/data/${unpadCik(cik)}/${accessionNumber.replace(/-/g, "")}`;
}

function filingDocumentUrl(cik: string, accessionNumber: string, documentName: string): string {
  return `${filingBaseUrl(cik, accessionNumber)}/${documentName}`;
}

function quarterFromReportDate(reportDate: string): string {
  const date = new Date(`${reportDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return reportDate;
  }

  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}Q${quarter}`;
}

function previousQuarter(quarter: string): string | null {
  const match = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const quarterNumber = Number(match[2]);
  return quarterNumber === 1 ? `${year - 1}Q4` : `${year}Q${quarterNumber - 1}`;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .trim();
}

function readXmlTag(xml: string, tagName: string): string | null {
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, "i");
  const match = pattern.exec(xml);
  return match?.[1]
    ? decodeXmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/<[^>]+>/g, " "))
    : null;
}

function readXmlNumber(xml: string, tagName: string): number | null {
  const value = readXmlTag(xml, tagName);
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isDollarValue13FFiling(filingDate: string): boolean {
  return filingDate >= DOLLAR_VALUE_REPORTING_START_DATE;
}

function reported13FValueUsd(value: number, filingDate: string): number {
  return isDollarValue13FFiling(filingDate) ? value : value * 1000;
}

function normalizeCusip(value: string | null): string | null {
  const cusip = value?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return cusip.length === 9 ? cusip : null;
}

function parse13FInformationTable(xml: string): Parsed13FHolding[] {
  const tablePattern = /<(?:\w+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  const holdings: Parsed13FHolding[] = [];
  let match = tablePattern.exec(xml);

  while (match) {
    const block = match[1];
    const cusip = normalizeCusip(readXmlTag(block, "cusip"));
    const nameOfIssuer = readXmlTag(block, "nameOfIssuer");
    const valueThousands = readXmlNumber(block, "value");
    const shares = readXmlNumber(block, "sshPrnamt");

    if (cusip && nameOfIssuer && valueThousands !== null && shares !== null) {
      holdings.push({
        nameOfIssuer,
        titleOfClass: readXmlTag(block, "titleOfClass"),
        cusip,
        valueThousands,
        shares,
        shareType: readXmlTag(block, "sshPrnamtType"),
        putCall: readXmlTag(block, "putCall"),
        investmentDiscretion: readXmlTag(block, "investmentDiscretion"),
        votingSole: readXmlNumber(block, "Sole"),
        votingShared: readXmlNumber(block, "Shared"),
        votingNone: readXmlNumber(block, "None"),
      });
    }

    match = tablePattern.exec(xml);
  }

  return holdings;
}

async function fetchLatest13FFiling(managerCik: string): Promise<Latest13FFiling> {
  const payload = await fetchSecJson<SecSubmissionsResponse>(`${SEC_DATA_BASE_URL}/submissions/CIK${managerCik}.json`, {
    cache: false,
  });
  const recent = payload.filings?.recent;
  if (!recent) {
    throw new Error(`No SEC submissions found for manager CIK ${managerCik}.`);
  }

  const forms = readRecentColumn(recent, "form");
  const accessionNumbers = readRecentColumn(recent, "accessionNumber");
  const filingDates = readRecentColumn(recent, "filingDate");
  const reportDates = readRecentColumn(recent, "reportDate");
  const primaryDocuments = readRecentColumn(recent, "primaryDocument");
  const index = forms.findIndex((form) => form === "13F-HR");

  if (index < 0 || !accessionNumbers[index]) {
    throw new Error(`No latest 13F-HR found for manager CIK ${managerCik}.`);
  }

  const accessionNumber = accessionNumbers[index];
  const primaryDocument = primaryDocuments[index] || "";

  return {
    managerCik,
    managerName: readString(payload.name) ?? managerCik,
    form: "13F-HR",
    amendmentNo: null,
    amendmentType: null,
    accessionNumber,
    filingDate: filingDates[index] || "",
    reportDate: reportDates[index] || "",
    primaryDocument,
    filingUrl: primaryDocument ? filingDocumentUrl(managerCik, accessionNumber, primaryDocument) : filingBaseUrl(managerCik, accessionNumber),
    directoryUrl: `${filingBaseUrl(managerCik, accessionNumber)}/index.json`,
  };
}

function isLikelyInformationTableFile(item: SecDirectoryItem): boolean {
  const name = readString(item.name)?.toLowerCase() ?? "";

  return name.endsWith(".xml");
}

function informationTableFileRank(item: SecDirectoryItem): number {
  const name = readString(item.name)?.toLowerCase() ?? "";
  if (name.includes("infotable") || name.includes("informationtable")) {
    return 0;
  }
  if (name.includes("form13f")) {
    return 1;
  }
  if (name === "primary_doc.xml" || name.includes("primary")) {
    return 3;
  }
  return 2;
}

async function fetchInformationTableXml(filing: Latest13FFiling): Promise<{ url: string; xml: string }> {
  const index = await fetchSecJson<SecDirectoryIndexResponse>(filing.directoryUrl, { cache: true });
  const items = Array.isArray(index.directory?.item) ? index.directory.item as SecDirectoryItem[] : [];
  const candidates = items
    .filter(isLikelyInformationTableFile)
    .sort((left, right) => informationTableFileRank(left) - informationTableFileRank(right));

  for (const candidate of candidates) {
    const name = readString(candidate.name);
    if (!name) {
      continue;
    }

    const url = filingDocumentUrl(filing.managerCik, filing.accessionNumber, name);
    const xml = await fetchSecText(url);
    if (parse13FInformationTable(xml).length > 0) {
      return { url, xml };
    }
  }

  throw new Error(`No parseable 13F information table XML found for accession ${filing.accessionNumber}.`);
}

async function loadCusipMappings(cusips: string[]): Promise<Map<string, SecurityIdMapping>> {
  const db = getAdminFirestore();
  const uniqueCusips = [...new Set(cusips)];
  const mappings = new Map<string, SecurityIdMapping>();

  for (let index = 0; index < uniqueCusips.length; index += HOLDING_BATCH_SIZE) {
    const refs = uniqueCusips.slice(index, index + HOLDING_BATCH_SIZE)
      .map((cusip) => db.collection("security_id_mappings").doc(cusip));
    const snapshots = await db.getAll(...refs);

    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        mappings.set(snapshot.id, snapshot.data() as SecurityIdMapping);
      }
    }
  }

  return mappings;
}

function normalizedKeyPart(value: string | null): string {
  return value?.trim().toUpperCase().replace(/\s+/g, " ") ?? "";
}

function holdingPositionKey(holding: Pick<Parsed13FHolding, "cusip" | "titleOfClass" | "shareType" | "putCall" | "investmentDiscretion">): string {
  const digest = createHash("sha256")
    .update([
      holding.cusip,
      normalizedKeyPart(holding.titleOfClass),
      normalizedKeyPart(holding.shareType),
      normalizedKeyPart(holding.putCall),
      normalizedKeyPart(holding.investmentDiscretion),
    ].join("|"))
    .digest("hex")
    .slice(0, 16);

  return `${holding.cusip}_${digest}`;
}

function holdingDocId(quarter: string, managerCik: string, positionKey: string): string {
  return `${quarter}_${managerCik}_${positionKey}`;
}

function changeDocId(quarter: string, managerCik: string, positionKey: string): string {
  return `${quarter}_${managerCik}_${positionKey}`;
}

function canonicalFilingDocId(managerCik: string, reportDate: string): string {
  return `${managerCik}_${reportDate}`;
}

function filingCanonicalRank(filing: Pick<Latest13FFiling, "form" | "amendmentNo" | "filingDate" | "accessionNumber">): string {
  const amendmentRank = filing.form === "13F-HR/A" ? Math.max(1, filing.amendmentNo ?? 1) : 0;
  return [
    String(amendmentRank).padStart(5, "0"),
    filing.filingDate,
    filing.accessionNumber,
  ].join("|");
}

function canonicalRankFromDocument(data: Canonical13FFilingDocument | undefined): string | null {
  const accessionNumber = readString(data?.accessionNumber);
  const filingDate = readString(data?.filingDate);
  const form = data?.form === "13F-HR/A" ? "13F-HR/A" : data?.form === "13F-HR" ? "13F-HR" : null;
  const amendmentNo = typeof data?.amendmentNo === "number" && Number.isFinite(data.amendmentNo) ? data.amendmentNo : null;

  if (!accessionNumber || !filingDate || !form) {
    return null;
  }

  return filingCanonicalRank({
    accessionNumber,
    filingDate,
    form,
    amendmentNo,
  });
}

async function loadPreviousHoldings(
  managerCik: string,
  quarter: string,
): Promise<Map<string, InstitutionalHolding>> {
  const priorQuarter = previousQuarter(quarter);
  if (!priorQuarter) {
    return new Map();
  }

  const db = getAdminFirestore();
  const previous = new Map<string, InstitutionalHolding>();
  const docPrefix = `${priorQuarter}_${managerCik}_`;
  const snapshot = await db
    .collection("institutional_holdings")
    .where(FieldPath.documentId(), ">=", docPrefix)
    .where(FieldPath.documentId(), "<", `${docPrefix}\uf8ff`)
    .orderBy(FieldPath.documentId())
    .get();

  for (const doc of snapshot.docs) {
    const holding = doc.data() as InstitutionalHolding;
    previous.set(holding.positionKey ?? holdingPositionKey(holding), holding);
  }

  return previous;
}

function buildHoldingChanges(
  holdings: InstitutionalHolding[],
  previousHoldings: Map<string, InstitutionalHolding>,
  filing: Latest13FFiling,
  quarter: string,
  updatedAt: string,
): InstitutionalHoldingChange[] {
  const currentHoldings = new Map(holdings.map((holding) => [holding.positionKey, holding]));
  const changes: InstitutionalHoldingChange[] = holdings.map((holding) => {
    const previous = previousHoldings.get(holding.positionKey);
    const previousShares = previous?.shares ?? 0;
    const previousValueUsd = previous?.valueUsd ?? 0;
    const shareChange = holding.shares - previousShares;
    const valueChangeUsd = holding.valueUsd - previousValueUsd;
    const percentChange = previousShares > 0 ? shareChange / previousShares : null;
    const status: InstitutionalHoldingChange["status"] = previous
      ? shareChange > 0
        ? "INCREASED"
        : shareChange < 0
          ? "REDUCED"
          : "UNCHANGED"
      : "NEW";

    return {
      quarter: holding.quarter,
      managerCik: holding.managerCik,
      managerName: holding.managerName,
      positionKey: holding.positionKey,
      cusip: holding.cusip,
      ticker: holding.ticker,
      nameOfIssuer: holding.nameOfIssuer,
      currentShares: holding.shares,
      previousShares,
      shareChange,
      percentChange,
      currentValueUsd: holding.valueUsd,
      previousValueUsd,
      valueChangeUsd,
      status,
      accessionNumber: holding.accessionNumber,
      filingDate: holding.filingDate,
      reportDate: holding.reportDate,
      updatedAt,
    };
  });

  for (const previous of previousHoldings.values()) {
    const positionKey = previous.positionKey ?? holdingPositionKey(previous);
    if (currentHoldings.has(positionKey)) {
      continue;
    }

    changes.push({
      quarter,
      managerCik: filing.managerCik,
      managerName: filing.managerName,
      positionKey,
      cusip: previous.cusip,
      ticker: previous.ticker,
      nameOfIssuer: previous.nameOfIssuer,
      currentShares: 0,
      previousShares: previous.shares,
      shareChange: -previous.shares,
      percentChange: previous.shares > 0 ? -1 : null,
      currentValueUsd: 0,
      previousValueUsd: previous.valueUsd,
      valueChangeUsd: -previous.valueUsd,
      status: "SOLD_OUT",
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      updatedAt,
    });
  }

  return changes;
}

async function persistManager13F(input: {
  filing: Latest13FFiling;
  infoTableUrl: string;
  holdings: InstitutionalHolding[];
  changes: InstitutionalHoldingChange[];
  dryRun: boolean;
  updatedAt: string;
}): Promise<{ holdingsWritten: number; changesWritten: number; canonicalStatus: Sync13FManagerResult["canonicalStatus"] }> {
  if (input.dryRun) {
    return { holdingsWritten: 0, changesWritten: 0, canonicalStatus: "UNKNOWN" };
  }

  const db = getAdminFirestore();
  const quarter = quarterFromReportDate(input.filing.reportDate);
  const canonicalId = canonicalFilingDocId(input.filing.managerCik, input.filing.reportDate);
  const canonicalRef = db.collection("institutional_13f_canonical_filings").doc(canonicalId);
  const nextRank = filingCanonicalRank(input.filing);
  const canonicalStatus = await db.runTransaction<Sync13FManagerResult["canonicalStatus"]>(async (transaction) => {
    const canonicalSnapshot = await transaction.get(canonicalRef);
    const existingCanonical = canonicalSnapshot.data() as Canonical13FFilingDocument | undefined;
    const existingCanonicalAccession = readString(existingCanonical?.accessionNumber);
    const existingRank = canonicalRankFromDocument(existingCanonical);
    const isCanonical = !existingRank ||
      nextRank >= existingRank ||
      existingCanonicalAccession === input.filing.accessionNumber;
    const nextCanonicalStatus: Sync13FManagerResult["canonicalStatus"] = isCanonical ? "CANONICAL" : "NON_CANONICAL";
    const filingRef = db.collection("institutional_13f_filings").doc(input.filing.accessionNumber);

    transaction.set(filingRef, {
      managerCik: input.filing.managerCik,
      managerName: input.filing.managerName,
      accessionNumber: input.filing.accessionNumber,
      form: input.filing.form,
      amendmentNo: input.filing.amendmentNo,
      amendmentType: input.filing.amendmentType,
      canonicalStatus: nextCanonicalStatus,
      canonicalKey: canonicalId,
      filingDate: input.filing.filingDate,
      reportDate: input.filing.reportDate,
      quarter,
      primaryDocument: input.filing.primaryDocument,
      filingUrl: input.filing.filingUrl,
      infoTableUrl: input.infoTableUrl,
      holdingCount: input.holdings.length,
      updatedAt: input.updatedAt,
    }, { merge: true });

    if (!isCanonical) {
      return nextCanonicalStatus;
    }

    if (existingCanonicalAccession && existingCanonicalAccession !== input.filing.accessionNumber) {
      transaction.set(db.collection("institutional_13f_filings").doc(existingCanonicalAccession), {
        canonicalStatus: "SUPERSEDED",
        supersededByAccessionNumber: input.filing.accessionNumber,
        supersededAt: input.updatedAt,
        updatedAt: input.updatedAt,
      }, { merge: true });
      transaction.set(db.collection("sec_13f_filings").doc(existingCanonicalAccession), {
        canonicalStatus: "SUPERSEDED",
        supersededByAccessionNumber: input.filing.accessionNumber,
        supersededAt: input.updatedAt,
        updatedAt: input.updatedAt,
      }, { merge: true });
    }

    transaction.set(db.collection("institutional_managers").doc(input.filing.managerCik), {
      cik: input.filing.managerCik,
      name: input.filing.managerName,
      latestAccessionNumber: input.filing.accessionNumber,
      latestReportDate: input.filing.reportDate,
      latestQuarter: quarter,
      updatedAt: input.updatedAt,
    }, { merge: true });

    transaction.set(canonicalRef, {
      canonicalKey: canonicalId,
      managerCik: input.filing.managerCik,
      managerName: input.filing.managerName,
      accessionNumber: input.filing.accessionNumber,
      form: input.filing.form,
      amendmentNo: input.filing.amendmentNo,
      amendmentType: input.filing.amendmentType,
      filingDate: input.filing.filingDate,
      reportDate: input.filing.reportDate,
      quarter,
      infoTableUrl: input.infoTableUrl,
      holdingCount: input.holdings.length,
      updatedAt: input.updatedAt,
    }, { merge: true });

    return nextCanonicalStatus;
  });
  let holdingsWritten = 0;
  let changesWritten = 0;

  if (canonicalStatus !== "CANONICAL") {
    return { holdingsWritten: 0, changesWritten: 0, canonicalStatus };
  }

  for (let index = 0; index < input.holdings.length; index += HOLDING_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = input.holdings.slice(index, index + HOLDING_BATCH_SIZE);

    for (const holding of chunk) {
      batch.set(db.collection("institutional_holdings").doc(holdingDocId(holding.quarter, holding.managerCik, holding.positionKey)), holding, { merge: true });
    }

    await batch.commit();
    holdingsWritten += chunk.length;
  }

  for (let index = 0; index < input.changes.length; index += HOLDING_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = input.changes.slice(index, index + HOLDING_BATCH_SIZE);

    for (const change of chunk) {
      batch.set(db.collection("institutional_holding_changes").doc(changeDocId(change.quarter, change.managerCik, change.positionKey)), change, { merge: true });
    }

    await batch.commit();
    changesWritten += chunk.length;
  }

  const holdingIds = new Set(input.holdings.map((holding) => holdingDocId(holding.quarter, holding.managerCik, holding.positionKey)));
  const changeIds = new Set(input.changes.map((change) => changeDocId(change.quarter, change.managerCik, change.positionKey)));
  const docPrefix = `${quarter}_${input.filing.managerCik}_`;
  const [existingHoldings, existingChanges] = await Promise.all([
    db.collection("institutional_holdings")
      .where(FieldPath.documentId(), ">=", docPrefix)
      .where(FieldPath.documentId(), "<", `${docPrefix}\uf8ff`)
      .orderBy(FieldPath.documentId())
      .get(),
    db.collection("institutional_holding_changes")
      .where(FieldPath.documentId(), ">=", docPrefix)
      .where(FieldPath.documentId(), "<", `${docPrefix}\uf8ff`)
      .orderBy(FieldPath.documentId())
      .get(),
  ]);

  const staleHoldingDocs = existingHoldings.docs.filter((doc) => !holdingIds.has(doc.id));
  const staleChangeDocs = existingChanges.docs.filter((doc) => !changeIds.has(doc.id));

  for (let index = 0; index < staleHoldingDocs.length; index += HOLDING_BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of staleHoldingDocs.slice(index, index + HOLDING_BATCH_SIZE)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  for (let index = 0; index < staleChangeDocs.length; index += HOLDING_BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of staleChangeDocs.slice(index, index + HOLDING_BATCH_SIZE)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  return { holdingsWritten, changesWritten, canonicalStatus };
}

export async function parseAndPersist13FFiling(input: {
  filing: Latest13FFiling;
  dryRun: boolean;
  updatedAt: string;
}): Promise<Sync13FManagerResult> {
  const filing = input.filing;
  const quarter = quarterFromReportDate(filing.reportDate);
  const infoTable = await fetchInformationTableXml(filing);
  const parsedHoldings = parse13FInformationTable(infoTable.xml);
  const mappings = await loadCusipMappings(parsedHoldings.map((holding) => holding.cusip));
  const holdings: InstitutionalHolding[] = parsedHoldings.map((holding) => {
    const mapping = mappings.get(holding.cusip);
    const ticker = readString(mapping?.ticker);

    return {
      ...holding,
      positionKey: holdingPositionKey(holding),
      quarter,
      managerCik: filing.managerCik,
      managerName: filing.managerName,
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      infoTableUrl: infoTable.url,
      ticker,
      providerSymbol: readString(mapping?.symbol),
      exchange: readString(mapping?.exchange),
      valueUsd: reported13FValueUsd(holding.valueThousands, filing.filingDate),
      source: "sec-13f",
      updatedAt: input.updatedAt,
    };
  });
  const previousHoldings = await loadPreviousHoldings(filing.managerCik, quarter);
  const changes = buildHoldingChanges(holdings, previousHoldings, filing, quarter, input.updatedAt);
  const written = await persistManager13F({
    filing,
    infoTableUrl: infoTable.url,
    holdings,
    changes,
    dryRun: input.dryRun,
    updatedAt: input.updatedAt,
  });

  return {
    managerCik: filing.managerCik,
    managerName: filing.managerName,
    accessionNumber: filing.accessionNumber,
    reportDate: filing.reportDate,
    quarter,
    infoTableUrl: infoTable.url,
    holdingsParsed: parsedHoldings.length,
    holdingsMapped: holdings.filter((holding) => holding.ticker).length,
    holdingsWritten: written.holdingsWritten,
    changesWritten: written.changesWritten,
    canonicalStatus: written.canonicalStatus,
    skipped: false,
    error: null,
  };
}

async function syncManager13F(managerCik: string, dryRun: boolean, updatedAt: string): Promise<Sync13FManagerResult> {
  try {
    const filing = await fetchLatest13FFiling(managerCik);
    return await parseAndPersist13FFiling({
      filing,
      dryRun,
      updatedAt,
    });
  } catch (error) {
    return {
      managerCik,
      managerName: managerCik,
      accessionNumber: null,
      reportDate: null,
      quarter: null,
      infoTableUrl: null,
      holdingsParsed: 0,
      holdingsMapped: 0,
      holdingsWritten: 0,
      changesWritten: 0,
      canonicalStatus: "UNKNOWN",
      skipped: false,
      error: error instanceof Error ? error.message : "Failed to sync 13F filing",
    };
  }
}

export async function syncLatest13FHoldings(input: Sync13FInput): Promise<Sync13FResult> {
  const managerCiks = normalizeManagerCiks(input.managerCiks);
  if (managerCiks.length === 0) {
    throw new Error("At least one manager CIK is required.");
  }

  const dryRun = input.dryRun === true;
  const updatedAt = new Date().toISOString();
  const items: Sync13FManagerResult[] = [];

  for (const managerCik of managerCiks) {
    items.push(await syncManager13F(managerCik, dryRun, updatedAt));
  }

  return {
    dryRun,
    requestedManagers: managerCiks.length,
    completedManagers: items.filter((item) => !item.error).length,
    failedManagers: items.filter((item) => item.error).length,
    holdingsParsed: items.reduce((total, item) => total + item.holdingsParsed, 0),
    holdingsWritten: items.reduce((total, item) => total + item.holdingsWritten, 0),
    changesWritten: items.reduce((total, item) => total + item.changesWritten, 0),
    items,
    updatedAt,
  };
}
