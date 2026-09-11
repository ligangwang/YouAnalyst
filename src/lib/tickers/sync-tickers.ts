import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyFields, COMPANY_COLLECTION } from "../market-companies/model";

const DEFAULT_COUNTRY = "United States";
const DEFAULT_CURRENCY = "USD";
// US-listed foreign companies such as TSM can be classified as depositary receipts.
const DEFAULT_TYPES = ["Common Stock", "ETF", "American Depositary Receipt", "Depositary Receipt"];
const TICKER_WRITE_BATCH_SIZE = 450;
const MAX_PREFIX_LENGTH = 16;
const NAME_PREFIX_MIN_LENGTH = 2;
const SYMBOL_PREFIX_MIN_LENGTH = 1;

const NAME_STOP_WORDS = new Set([
  "adr",
  "and",
  "class",
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "limited",
  "ltd",
  "plc",
  "sa",
  "shares",
  "stock",
  "the",
]);

type TwelveDataStocksResponse = {
  data?: unknown;
  count?: unknown;
  status?: unknown;
  message?: unknown;
};

type TwelveDataStock = {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  mic_code: string;
  country: string;
  type: string;
  figi_code?: string;
  cfi_code?: string;
};

export type TickerCatalogSyncInput = {
  dryRun?: boolean;
  country?: string;
  currency?: string;
  types?: string[];
  limit?: number;
};

export type TickerCatalogDocument = {
  id: string;
  symbol: string;
  symbolLower: string;
  name: string;
  nameLower: string;
  exchange: string;
  exchangeLower: string;
  micCode: string;
  currency: string;
  country: string;
  type: string;
  figiCode: string | null;
  cfiCode: string | null;
  active: true;
  predictionSupported: true;
  exchangePriority: number;
  symbolPrefixes: string[];
  namePrefixes: string[];
  searchPrefixes: string[];
  provider: "twelve-data";
  providerSource: "stocks";
  lastSyncedAt: string;
  syncRunId: string;
};

export type TickerCatalogSyncResult = {
  dryRun: boolean;
  country: string;
  currency: string;
  types: string[];
  providerCount: number;
  filteredCount: number;
  attemptedWrites: number;
  written: number;
  batchesCommitted: number;
  sample: Array<Pick<TickerCatalogDocument, "id" | "symbol" | "name" | "exchange" | "micCode" | "type">>;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStock(value: unknown): TwelveDataStock | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const symbol = readString(source.symbol);
  const name = readString(source.name);
  const currency = readString(source.currency);
  const exchange = readString(source.exchange);
  const micCode = readString(source.mic_code);
  const country = readString(source.country);
  const type = readString(source.type);

  if (!symbol || !name || !currency || !exchange || !micCode || !country || !type) {
    return null;
  }

  return {
    symbol,
    name,
    currency,
    exchange,
    mic_code: micCode,
    country,
    type,
    figi_code: readString(source.figi_code) ?? undefined,
    cfi_code: readString(source.cfi_code) ?? undefined,
  };
}

function getTwelveDataStocksUrl(): URL {
  const apiUrl = (process.env.TWELVE_DATA_API_URL?.trim() || "https://api.twelvedata.com").replace(/\/$/, "");
  const url = new URL(`${apiUrl}/stocks`);
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();

  if (apiKey) {
    url.searchParams.set("apikey", apiKey);
  }

  return url;
}

function normalizeLower(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDocIdPart(value: string): string {
  return value.trim().toUpperCase().replace(/\//g, "-");
}

function tickerDocId(symbol: string, micCode: string): string {
  return `${normalizeDocIdPart(symbol)}_${normalizeDocIdPart(micCode)}`;
}

function prefixesFor(value: string, minLength: number): string[] {
  const normalized = value.trim().toLowerCase();
  const maxLength = Math.min(normalized.length, MAX_PREFIX_LENGTH);
  const prefixes: string[] = [];

  for (let index = minLength; index <= maxLength; index += 1) {
    prefixes.push(normalized.slice(0, index));
  }

  return prefixes;
}

function tokenizeName(name: string): string[] {
  return Array.from(
    new Set(
      name
        .toLowerCase()
        .replace(/&/g, " and ")
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= NAME_PREFIX_MIN_LENGTH && !NAME_STOP_WORDS.has(token)),
    ),
  );
}

function buildNamePrefixes(name: string): string[] {
  const prefixes = new Set<string>();

  for (const token of tokenizeName(name)) {
    for (const prefix of prefixesFor(token, NAME_PREFIX_MIN_LENGTH)) {
      prefixes.add(prefix);
    }
  }

  return Array.from(prefixes).sort();
}

function exchangePriority(exchange: string, micCode: string): number {
  const exchangeUpper = exchange.trim().toUpperCase();
  const micUpper = micCode.trim().toUpperCase();

  if (exchangeUpper === "NASDAQ" || micUpper === "XNAS" || micUpper === "XNGS" || micUpper === "XNCM") {
    return 100;
  }
  if (exchangeUpper === "NYSE" || micUpper === "XNYS") {
    return 95;
  }
  if (exchangeUpper === "NYSE ARCA" || micUpper === "ARCX") {
    return 90;
  }
  if (exchangeUpper === "NYSE AMERICAN" || micUpper === "XASE") {
    return 85;
  }
  if (exchangeUpper === "BATS" || micUpper === "BATS") {
    return 80;
  }

  return 50;
}

function normalizeTickerDocument(stock: TwelveDataStock, lastSyncedAt: string, syncRunId: string): TickerCatalogDocument {
  const symbolPrefixes = prefixesFor(stock.symbol, SYMBOL_PREFIX_MIN_LENGTH);
  const namePrefixes = buildNamePrefixes(stock.name);

  return {
    id: tickerDocId(stock.symbol, stock.mic_code),
    symbol: stock.symbol.trim().toUpperCase(),
    symbolLower: normalizeLower(stock.symbol),
    name: stock.name.trim(),
    nameLower: normalizeLower(stock.name),
    exchange: stock.exchange.trim(),
    exchangeLower: normalizeLower(stock.exchange),
    micCode: stock.mic_code.trim().toUpperCase(),
    currency: stock.currency.trim().toUpperCase(),
    country: stock.country.trim(),
    type: stock.type.trim(),
    figiCode: stock.figi_code?.trim() || null,
    cfiCode: stock.cfi_code?.trim() || null,
    active: true,
    predictionSupported: true,
    exchangePriority: exchangePriority(stock.exchange, stock.mic_code),
    symbolPrefixes,
    namePrefixes,
    searchPrefixes: Array.from(new Set([...symbolPrefixes, ...namePrefixes])).sort(),
    provider: "twelve-data",
    providerSource: "stocks",
    lastSyncedAt,
    syncRunId,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function clampLimit(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

async function fetchTwelveDataStocks(): Promise<{ providerCount: number; stocks: TwelveDataStock[] }> {
  const url = getTwelveDataStocksUrl();
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Twelve Data stocks request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as TwelveDataStocksResponse;
  if (body.status === "error") {
    throw new Error(readString(body.message) ?? "Twelve Data stocks request failed");
  }

  if (!Array.isArray(body.data)) {
    throw new Error("Twelve Data stocks response did not include a data array");
  }

  const stocks = body.data.map(readStock).filter((stock): stock is TwelveDataStock => Boolean(stock));
  const providerCount = Number(body.count ?? body.data.length);

  return {
    providerCount: Number.isFinite(providerCount) ? providerCount : body.data.length,
    stocks,
  };
}

export async function runTickerCatalogSync(input: TickerCatalogSyncInput = {}): Promise<TickerCatalogSyncResult> {
  const dryRun = input.dryRun ?? true;
  const country = input.country?.trim() || DEFAULT_COUNTRY;
  const countryLower = country.toLowerCase();
  const currency = input.currency?.trim().toUpperCase() || DEFAULT_CURRENCY;
  const types = input.types?.length ? input.types.map((type) => type.trim()).filter(Boolean) : DEFAULT_TYPES;
  const typeSet = new Set(types.map((type) => type.toLowerCase()));
  const limit = clampLimit(input.limit);
  const lastSyncedAt = new Date().toISOString();
  const syncRunId = lastSyncedAt;

  console.info("[sync-tickers] Starting ticker catalog sync", {
    dryRun,
    country,
    currency,
    types,
    limit,
  });

  const { providerCount, stocks } = await fetchTwelveDataStocks();
  const filteredStocks = stocks.filter(
    (stock) =>
      stock.country.toLowerCase() === countryLower &&
      stock.currency.toUpperCase() === currency &&
      typeSet.has(stock.type.toLowerCase()),
  );
  const limitedStocks = typeof limit === "number" ? filteredStocks.slice(0, limit) : filteredStocks;
  const documentById = new Map<string, TickerCatalogDocument>();
  for (const stock of limitedStocks) {
    const document = normalizeTickerDocument(stock, lastSyncedAt, syncRunId);
    if (!documentById.has(document.id)) {
      documentById.set(document.id, document);
    }
  }
  const documents = Array.from(documentById.values());
  let written = 0;
  let batchesCommitted = 0;

  if (!dryRun && documents.length > 0) {
    const db = getAdminFirestore();
    const companies = new Map<string, TickerCatalogDocument>();
    for (const ticker of documents) if (!companies.has(ticker.symbol) || ticker.exchangePriority > companies.get(ticker.symbol)!.exchangePriority) companies.set(ticker.symbol, ticker);
    for (const group of chunk([...companies.values()], 200)) {
      const batch = db.batch();
      for (const ticker of group) { const id = `US:${ticker.symbol}`; batch.set(db.collection(COMPANY_COLLECTION).doc(id), {...ticker,...companyFields(id,ticker)}, {merge:true}); }
      await batch.commit();
    }

    for (const documentChunk of chunk(documents, TICKER_WRITE_BATCH_SIZE)) {
      const batch = db.batch();

      for (const ticker of documentChunk) {
        batch.set(db.collection("tickers").doc(ticker.id), ticker, { merge: true });
      }

      await batch.commit();
      written += documentChunk.length;
      batchesCommitted += 1;
    }
  }

  const result: TickerCatalogSyncResult = {
    dryRun,
    country,
    currency,
    types,
    providerCount,
    filteredCount: filteredStocks.length,
    attemptedWrites: documents.length,
    written,
    batchesCommitted,
    sample: documents.slice(0, 10).map((ticker) => ({
      id: ticker.id,
      symbol: ticker.symbol,
      name: ticker.name,
      exchange: ticker.exchange,
      micCode: ticker.micCode,
      type: ticker.type,
    })),
  };

  console.info("[sync-tickers] Completed ticker catalog sync", result);
  return result;
}
