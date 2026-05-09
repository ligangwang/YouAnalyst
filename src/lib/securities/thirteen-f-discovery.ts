import { getAdminFirestore } from "@/lib/firebase/admin";

const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives";
const DISCOVERY_BATCH_SIZE = 450;
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_LOOKBACK_DAYS = 14;
const MAX_DISCOVERED_FILINGS = 5000;

type SecMasterIndexRow = {
  managerCik: string;
  managerName: string;
  form: "13F-HR" | "13F-HR/A";
  filingDate: string;
  filename: string;
  accessionNumber: string;
  filingUrl: string;
};

export type Discover13FFilingsInput = {
  date?: string;
  dates?: string[];
  lookbackDays?: number;
  maxFilings?: number;
  dryRun?: boolean;
};

export type Discover13FIndexResult = {
  date: string;
  indexUrl: string;
  filingsFound: number;
  filingsQueued: number;
  filingsExisting: number;
  error: string | null;
};

export type Discover13FFilingsResult = {
  dryRun: boolean;
  datesRequested: string[];
  filingsFound: number;
  filingsQueued: number;
  filingsExisting: number;
  indexes: Discover13FIndexResult[];
  updatedAt: string;
};

function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (userAgent) {
    return userAgent;
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://youanalyst.com";
  return `YouAnalyst 13F discovery ${appUrl}`;
}

async function fetchSecText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "text/plain,*/*",
      "user-agent": getSecUserAgent(),
    },
  });

  if (!response.ok) {
    throw new Error(`SEC index request failed (${response.status}): ${url}`);
  }

  return response.text();
}

function padCik(value: string): string {
  return value.replace(/\D/g, "").padStart(10, "0");
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

function normalizeDates(input: Discover13FFilingsInput): string[] {
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

function formatIsoDateOrThrow(value: string): string {
  const date = parseIsoDate(value);
  if (!date) {
    throw new Error(`Invalid SEC index date "${value}". Expected YYYY-MM-DD.`);
  }

  return formatIsoDate(date);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function accessionFromFilename(filename: string): string | null {
  const lastSegment = filename.split("/").pop() ?? "";
  const accession = lastSegment.replace(/\.txt$/i, "");
  return /^\d{10}-\d{2}-\d{6}$/.test(accession) ? accession : null;
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

    const [cik, managerName, form, rawFilingDate, filename] = trimmed.split("|");
    const filingDate = normalizeIndexDate(rawFilingDate);
    if ((form !== "13F-HR" && form !== "13F-HR/A") || !cik || !managerName || !filingDate || !filename) {
      continue;
    }

    const accessionNumber = accessionFromFilename(filename);
    if (!accessionNumber) {
      continue;
    }

    rows.push({
      managerCik: padCik(cik),
      managerName: managerName.trim(),
      form,
      filingDate,
      filename,
      accessionNumber,
      filingUrl: `${SEC_ARCHIVES_BASE_URL}/${filename}`,
    });
  }

  return rows;
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

async function persistDiscoveredFilings(input: {
  filings: SecMasterIndexRow[];
  dryRun: boolean;
  discoveredAt: string;
}): Promise<{ queued: number; existing: number }> {
  if (input.filings.length === 0) {
    return { queued: 0, existing: 0 };
  }

  if (input.dryRun) {
    return { queued: 0, existing: 0 };
  }

  const db = getAdminFirestore();
  let queued = 0;
  let existing = 0;

  for (let index = 0; index < input.filings.length; index += DISCOVERY_BATCH_SIZE) {
    const chunk = input.filings.slice(index, index + DISCOVERY_BATCH_SIZE);
    const refs = chunk.map((filing) => db.collection("sec_13f_filings").doc(filing.accessionNumber));
    const snapshots = await db.getAll(...refs);
    const batch = db.batch();

    chunk.forEach((filing, chunkIndex) => {
      const ref = refs[chunkIndex];
      const snapshot = snapshots[chunkIndex];

      if (snapshot.exists) {
        existing += 1;
        batch.set(ref, {
          lastDiscoveredAt: input.discoveredAt,
          sourceIndexFilingDate: filing.filingDate,
        }, { merge: true });
        return;
      }

      queued += 1;
      batch.set(ref, {
        accessionNumber: filing.accessionNumber,
        managerCik: filing.managerCik,
        managerName: filing.managerName,
        form: filing.form,
        filingDate: filing.filingDate,
        filename: filing.filename,
        filingUrl: filing.filingUrl,
        status: "DISCOVERED",
        attempts: 0,
        lastError: null,
        discoveredAt: input.discoveredAt,
        lastDiscoveredAt: input.discoveredAt,
        processedAt: null,
        source: "sec-daily-master-index",
      }, { merge: true });
    });

    await batch.commit();
  }

  return { queued, existing };
}

export async function discover13FFilings(input: Discover13FFilingsInput): Promise<Discover13FFilingsResult> {
  const dryRun = input.dryRun === true;
  const updatedAt = new Date().toISOString();
  const maxFilings = clampInteger(input.maxFilings, MAX_DISCOVERED_FILINGS, 1, MAX_DISCOVERED_FILINGS);
  const datesRequested = normalizeDates(input);
  const indexes: Discover13FIndexResult[] = [];

  for (const date of datesRequested) {
    const indexUrl = dailyMasterIndexUrl(date);

    try {
      const text = await fetchSecText(indexUrl);
      const filings = parseMasterIndex(text).slice(0, maxFilings);
      const persisted = await persistDiscoveredFilings({
        filings,
        dryRun,
        discoveredAt: updatedAt,
      });

      indexes.push({
        date,
        indexUrl,
        filingsFound: filings.length,
        filingsQueued: persisted.queued,
        filingsExisting: persisted.existing,
        error: null,
      });
    } catch (error) {
      indexes.push({
        date,
        indexUrl,
        filingsFound: 0,
        filingsQueued: 0,
        filingsExisting: 0,
        error: error instanceof Error ? error.message : "Failed to discover SEC 13F filings",
      });
    }
  }

  return {
    dryRun,
    datesRequested,
    filingsFound: indexes.reduce((total, item) => total + item.filingsFound, 0),
    filingsQueued: indexes.reduce((total, item) => total + item.filingsQueued, 0),
    filingsExisting: indexes.reduce((total, item) => total + item.filingsExisting, 0),
    indexes,
    updatedAt,
  };
}
