import { getAdminFirestore } from "@/lib/firebase/admin";

const DEFAULT_EXCHANGE = "US";
const DEFAULT_PAGE_LIMIT = 1000;
const DEFAULT_OPENFIGI_CUSIP_LIMIT = 100;
const MAX_PAGE_LIMIT = 1000;
const MAX_SYNC_PAGES = 5;
const MAX_OPENFIGI_CUSIP_LIMIT = 1000;
const EODHD_MAPPING_SOURCE = "eodhd-id-mapping";
const OPENFIGI_MAPPING_SOURCE = "openfigi";
const MAPPING_BATCH_SIZE = 450;
const OPENFIGI_UNAUTHENTICATED_BATCH_SIZE = 10;
const OPENFIGI_AUTHENTICATED_BATCH_SIZE = 100;

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
  source: typeof EODHD_MAPPING_SOURCE | typeof OPENFIGI_MAPPING_SOURCE;
  updatedAt: string;
};

type OpenFigiMappingResult = {
  figi?: unknown;
  name?: unknown;
  ticker?: unknown;
  exchCode?: unknown;
  compositeFIGI?: unknown;
  shareClassFIGI?: unknown;
  securityType?: unknown;
  securityType2?: unknown;
  securityDescription?: unknown;
};

type OpenFigiMappingResponseItem = {
  data?: unknown;
  warning?: unknown;
  error?: unknown;
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

export type SyncOpenFigiCusipMappingsInput = {
  exchange?: string;
  maxCusips?: number;
  dryRun?: boolean;
};

export type SyncOpenFigiCusipMappingsResult = {
  dryRun: boolean;
  exchange: string;
  maxCusips: number;
  fetched: number;
  mapped: number;
  written: number;
  skipped: number;
  pages: number;
  hasMore: boolean;
  nextOffset: null;
  updatedAt: string;
  source: typeof OPENFIGI_MAPPING_SOURCE;
  warnings: number;
  errors: number;
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

function normalizeOpenFigiCusipLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_OPENFIGI_CUSIP_LIMIT;
  }

  return Math.max(1, Math.min(MAX_OPENFIGI_CUSIP_LIMIT, Math.trunc(value as number)));
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
    source: EODHD_MAPPING_SOURCE,
    updatedAt,
  };
}

function parseOpenFigiMappingRecord(cusip: string, record: OpenFigiMappingResult, exchange: string, updatedAt: string): SecurityIdMapping | null {
  const ticker = normalizeSymbol(record.ticker);
  const mappedExchange = normalizeSymbol(record.exchCode) ?? exchange;

  if (!ticker) {
    return null;
  }

  return {
    cusip,
    symbol: `${ticker}.${mappedExchange}`,
    ticker,
    exchange: mappedExchange,
    isin: null,
    figi: readString(record.compositeFIGI) ?? readString(record.figi),
    lei: null,
    cik: null,
    source: OPENFIGI_MAPPING_SOURCE,
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

async function listUnmappedCusips(limit: number): Promise<string[]> {
  const db = getAdminFirestore();
  const snapshot = await db
    .collection("institutional_holdings")
    .where("ticker", "==", null)
    .limit(limit * 5)
    .get();
  const cusips: string[] = [];
  const seen = new Set<string>();

  for (const doc of snapshot.docs) {
    const cusip = normalizeCusip(doc.get("cusip"));
    if (!cusip || seen.has(cusip)) {
      continue;
    }

    const mapping = await db.collection("security_id_mappings").doc(cusip).get();
    if (readString(mapping.get("ticker"))) {
      continue;
    }

    seen.add(cusip);
    cusips.push(cusip);

    if (cusips.length >= limit) {
      break;
    }
  }

  return cusips;
}

async function fetchOpenFigiMappings(cusips: string[], exchange: string): Promise<OpenFigiMappingResponseItem[]> {
  const apiKey = process.env.OPENFIGI_API_KEY?.trim() ?? "";
  const body = cusips.map((cusip) => ({
    idType: "ID_CUSIP",
    idValue: cusip,
    exchCode: exchange,
  }));
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (apiKey) {
    headers["x-openfigi-apikey"] = apiKey;
  }

  const response = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => []) as unknown;

  if (!response.ok) {
    const message = Array.isArray(payload) ? response.statusText : readString((payload as { error?: unknown }).error) ?? response.statusText;
    throw new Error(`OpenFIGI mapping request failed with HTTP ${response.status}: ${message}`);
  }

  return Array.isArray(payload) ? payload as OpenFigiMappingResponseItem[] : [];
}

export async function syncOpenFigiCusipMappings(input: SyncOpenFigiCusipMappingsInput = {}): Promise<SyncOpenFigiCusipMappingsResult> {
  const exchange = normalizeExchange(input.exchange);
  const maxCusips = normalizeOpenFigiCusipLimit(input.maxCusips);
  const dryRun = input.dryRun === true;
  const updatedAt = new Date().toISOString();
  const cusips = await listUnmappedCusips(maxCusips);
  const hasApiKey = Boolean(process.env.OPENFIGI_API_KEY?.trim());
  const batchSize = hasApiKey ? OPENFIGI_AUTHENTICATED_BATCH_SIZE : OPENFIGI_UNAUTHENTICATED_BATCH_SIZE;
  let mapped = 0;
  let written = 0;
  let skipped = 0;
  let warnings = 0;
  let errors = 0;
  let pages = 0;

  for (let index = 0; index < cusips.length; index += batchSize) {
    const chunk = cusips.slice(index, index + batchSize);
    const responseItems = await fetchOpenFigiMappings(chunk, exchange);
    pages += 1;
    const mappings: SecurityIdMapping[] = [];

    for (let itemIndex = 0; itemIndex < chunk.length; itemIndex += 1) {
      const item = responseItems[itemIndex];
      const data = Array.isArray(item?.data) ? item.data as OpenFigiMappingResult[] : [];
      const firstResult = data.find((record) => normalizeSymbol(record.exchCode) === exchange && normalizeSymbol(record.ticker)) ?? data.find((record) => normalizeSymbol(record.ticker));
      const mapping = firstResult ? parseOpenFigiMappingRecord(chunk[itemIndex], firstResult, exchange, updatedAt) : null;

      if (item?.warning) {
        warnings += 1;
      }
      if (item?.error) {
        errors += 1;
      }
      if (!mapping) {
        skipped += 1;
        continue;
      }

      mappings.push(mapping);
    }

    mapped += mappings.length;
    if (!dryRun && mappings.length > 0) {
      written += await persistMappings(mappings);
    }
  }

  if (!dryRun) {
    await getAdminFirestore().collection("security_id_mapping_sync_runs").add({
      exchange,
      source: OPENFIGI_MAPPING_SOURCE,
      pageLimit: batchSize,
      startOffset: 0,
      nextOffset: null,
      total: cusips.length,
      fetched: cusips.length,
      mapped,
      written,
      skipped,
      pages,
      hasMore: false,
      warnings,
      errors,
      updatedAt,
    });
  }

  return {
    dryRun,
    exchange,
    maxCusips,
    fetched: cusips.length,
    mapped,
    written: dryRun ? 0 : written,
    skipped,
    pages,
    hasMore: false,
    nextOffset: null,
    updatedAt,
    source: OPENFIGI_MAPPING_SOURCE,
    warnings,
    errors,
  };
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
      source: EODHD_MAPPING_SOURCE,
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
