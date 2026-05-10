import { getAdminFirestore } from "@/lib/firebase/admin";

const DEFAULT_EXCHANGE = "US";
const DEFAULT_PAGE_LIMIT = 1000;
const MAX_PAGE_LIMIT = 1000;
const MAX_SYNC_PAGES = 5;
const MAPPING_SOURCE = "eodhd-id-mapping";
const MAPPING_BATCH_SIZE = 450;

type EodhdIdMappingRecord = {
  symbol?: unknown;
  isin?: unknown;
  figi?: unknown;
  lei?: unknown;
  cusip?: unknown;
  cik?: unknown;
};

type EodhdIdMappingResponse = {
  meta?: {
    total?: unknown;
    limit?: unknown;
    offset?: unknown;
  };
  data?: unknown;
  links?: {
    next?: unknown;
  };
};

export type SecurityIdMapping = {
  cusip: string;
  symbol: string;
  ticker: string;
  exchange: string;
  isin: string | null;
  figi: string | null;
  lei: string | null;
  cik: string | null;
  source: typeof MAPPING_SOURCE;
  updatedAt: string;
};

export type SyncEodhdIdMappingsInput = {
  exchange?: string;
  pageLimit?: number;
  pageOffset?: number;
  maxPages?: number;
  dryRun?: boolean;
};

export type SyncEodhdIdMappingsResult = {
  dryRun: boolean;
  exchange: string;
  pageLimit: number;
  startOffset: number;
  nextOffset: number | null;
  total: number | null;
  fetched: number;
  mapped: number;
  written: number;
  skipped: number;
  pages: number;
  hasMore: boolean;
  updatedAt: string;
};

function getEodhdConfig(): { apiToken: string; apiUrl: string } {
  const apiToken = process.env.EODHD_API_TOKEN?.trim() ?? "";
  if (!apiToken) {
    throw new Error("EODHD_API_TOKEN is not configured.");
  }

  return {
    apiToken,
    apiUrl: (process.env.EODHD_API_URL?.trim() || "https://eodhd.com").replace(/\/$/, ""),
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeExchange(value: string | undefined): string {
  return (value?.trim() || DEFAULT_EXCHANGE).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function normalizePageLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PAGE_LIMIT;
  }

  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.trunc(value as number)));
}

function normalizePageOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value as number));
}

function normalizeMaxPages(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return MAX_SYNC_PAGES;
  }

  return Math.max(1, Math.min(MAX_SYNC_PAGES, Math.trunc(value as number)));
}

function normalizeCusip(value: unknown): string | null {
  const cusip = readString(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;
  return cusip && cusip.length === 9 ? cusip : null;
}

function normalizeSymbol(value: unknown): string | null {
  return readString(value)?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? null;
}

function tickerFromSymbol(symbol: string, exchange: string): string {
  const suffix = `.${exchange}`;
  return symbol.endsWith(suffix) ? symbol.slice(0, -suffix.length) : symbol;
}

function parseMappingRecord(record: EodhdIdMappingRecord, exchange: string, updatedAt: string): SecurityIdMapping | null {
  const cusip = normalizeCusip(record.cusip);
  const symbol = normalizeSymbol(record.symbol);

  if (!cusip || !symbol) {
    return null;
  }

  return {
    cusip,
    symbol,
    ticker: tickerFromSymbol(symbol, exchange),
    exchange,
    isin: readString(record.isin),
    figi: readString(record.figi),
    lei: readString(record.lei),
    cik: readString(record.cik),
    source: MAPPING_SOURCE,
    updatedAt,
  };
}

async function fetchEodhdMappingPage(input: {
  exchange: string;
  pageLimit: number;
  pageOffset: number;
}): Promise<EodhdIdMappingResponse> {
  const config = getEodhdConfig();
  const url = new URL(`${config.apiUrl}/api/id-mapping`);
  url.searchParams.set("filter[ex]", input.exchange);
  url.searchParams.set("page[limit]", String(input.pageLimit));
  url.searchParams.set("page[offset]", String(input.pageOffset));
  url.searchParams.set("api_token", config.apiToken);
  url.searchParams.set("fmt", "json");

  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as EodhdIdMappingResponse & { error?: unknown; message?: unknown };
  if (!response.ok) {
    const message = readString(body.error) ?? readString(body.message) ?? response.statusText;
    throw new Error(`EODHD ID mapping request failed with HTTP ${response.status}: ${message}`);
  }

  return body;
}

async function persistMappings(mappings: SecurityIdMapping[]): Promise<number> {
  const db = getAdminFirestore();
  let written = 0;

  for (let index = 0; index < mappings.length; index += MAPPING_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = mappings.slice(index, index + MAPPING_BATCH_SIZE);

    for (const mapping of chunk) {
      batch.set(db.collection("security_id_mappings").doc(mapping.cusip), mapping, { merge: true });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

export async function syncEodhdIdMappings(input: SyncEodhdIdMappingsInput = {}): Promise<SyncEodhdIdMappingsResult> {
  const exchange = normalizeExchange(input.exchange);
  const pageLimit = normalizePageLimit(input.pageLimit);
  const startOffset = normalizePageOffset(input.pageOffset);
  const maxPages = normalizeMaxPages(input.maxPages);
  const dryRun = input.dryRun === true;
  const updatedAt = new Date().toISOString();
  let pageOffset = startOffset;
  let total: number | null = null;
  let fetched = 0;
  let mapped = 0;
  let written = 0;
  let skipped = 0;
  let pages = 0;
  let hasMore = false;

  for (; pages < maxPages;) {
    const page = await fetchEodhdMappingPage({ exchange, pageLimit, pageOffset });
    pages += 1;
    const rows = Array.isArray(page.data) ? page.data as EodhdIdMappingRecord[] : [];
    const pageTotal = readNumber(page.meta?.total);
    if (pageTotal !== null) {
      total = pageTotal;
    }

    fetched += rows.length;
    const mappings = rows.flatMap((row) => {
      const mapping = parseMappingRecord(row, exchange, updatedAt);
      if (!mapping) {
        skipped += 1;
        return [];
      }

      return [mapping];
    });
    mapped += mappings.length;

    if (!dryRun && mappings.length > 0) {
      written += await persistMappings(mappings);
    }

    const nextOffset = pageOffset + pageLimit;
    hasMore = Boolean(readString(page.links?.next)) || (total !== null && nextOffset < total);
    pageOffset = nextOffset;

    if (!hasMore || rows.length === 0) {
      break;
    }
  }

  if (!dryRun) {
    await getAdminFirestore().collection("security_id_mapping_sync_runs").add({
      exchange,
      source: MAPPING_SOURCE,
      pageLimit,
      startOffset,
      nextOffset: hasMore ? pageOffset : null,
      total,
      fetched,
      mapped,
      written,
      skipped,
      pages,
      hasMore,
      updatedAt,
    });
  }

  return {
    dryRun,
    exchange,
    pageLimit,
    startOffset,
    nextOffset: hasMore ? pageOffset : null,
    total,
    fetched,
    mapped,
    written: dryRun ? 0 : written,
    skipped,
    pages,
    hasMore,
    updatedAt,
  };
}
