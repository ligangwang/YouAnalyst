import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase/admin";
import {
  computePredictionOutcome,
  computePredictionReturn,
  computePredictionScore,
  computePredictionXp,
  computeUserAnalytics,
} from "@/lib/predictions/analytics";
import { recomputeUserAnalytics } from "@/lib/predictions/user-analytics";
import {
  canonicalPredictionStatus,
  isPredictionDirection,
  normalizeTicker,
  type PredictionResult,
  type PredictionStatus,
} from "@/lib/predictions/types";

const EOD_PRICE_SOURCE = "twelve-data-time-series";
const EODHD_BULK_EOD_PRICE_SOURCE = "eodhd-bulk-eod";
const DEFAULT_MARKET = "US";
const POSITION_SCAN_PAGE_SIZE = 500;
const ROLL_FORWARD_PRICE_SCAN_PAGE_SIZE = 1000;
const TWELVE_DATA_CHUNK_SIZE = 8;
const PREVIOUS_EOD_PRICE_LOOKBACK_DAYS = 30;
const EODHD_BULK_GCS_PREFIX = "eodhd-bulk-eod";
const DEFAULT_ROLL_FORWARD_BATCH_SIZE = 5;
const MAX_ROLL_FORWARD_BATCH_SIZE = 20;

export type DailyEodMaintenanceInput = {
  runDate?: string;
  limit?: number;
  dryRun?: boolean;
  tickers?: string[];
  loadPrices?: boolean;
  markPredictions?: boolean;
  rollForward?: boolean;
  rollForwardBatchSize?: number;
  recompute?: boolean;
};

export type EodPrice = {
  market: string;
  ticker: string;
  requestedDate: string;
  tradingDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
  providerSymbol: string;
  exchange: string | null;
  exchangeTimezone: string | null;
  micCode: string | null;
  loadedAt: string;
  isFinal: true;
  previousClose: number | null;
  previousTradingDate: string | null;
  dailyReturn: number | null;
};

export type DailyEodMaintenanceResult = {
  dryRun: boolean;
  recompute: boolean;
  runDate: string;
  latestTradingDate: string | null;
  candidatePredictions: number;
  actionablePredictions: number;
  scannedCandidatePredictions: number;
  hasMoreCandidatePredictions: boolean;
  priceLoad: {
    provider: string | null;
    rawGcsPath: string | null;
    rawCacheHit: boolean;
    requestedTickers: number;
    cacheHits: number;
    loaded: number;
    failed: number;
    skipped: number;
    prices: Array<Pick<EodPrice, "ticker" | "tradingDate" | "close" | "source" | "previousClose" | "previousTradingDate" | "dailyReturn">>;
    failures: Array<{ ticker: string; reason: string }>;
  };
  marking: {
    checked: number;
    opened: number;
    marked: number;
    closed: number;
    missingPrice: number;
    skipped: number;
  };
  dailySnapshots: {
    predictionMarks: number;
    userScores: number;
    skippedUsers: number;
  };
  rollForward?: {
    startDate: string;
    endDate: string | null;
    runDates: string[];
    hasMore: boolean;
    nextRunDate: string | null;
  };
};

type TwelveDataTimeSeriesValue = {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
};

type TwelveDataSymbolResponse = {
  meta?: {
    symbol?: string;
    exchange?: string;
    exchange_timezone?: string;
    mic_code?: string;
  };
  values?: TwelveDataTimeSeriesValue[];
  status?: string;
  message?: string;
};

type TwelveDataBatchResponse = Record<string, TwelveDataSymbolResponse>;

type EodhdBulkEodRow = {
  code?: string;
  exchange_short_name?: string;
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjusted_close?: number;
  volume?: number;
};

type EodPriceFetchResult = {
  provider: string;
  prices: EodPrice[];
  failures: Array<{ ticker: string; reason: string }>;
  rawGcsPath: string | null;
  rawCacheHit: boolean;
};

type EodPredictionRecord = {
  ref: FirebaseFirestore.DocumentReference;
  id: string;
  userId: string;
  ticker: string;
  storedStatus: string;
  direction: unknown;
  entryPrice: number | null;
  entryDate: string | null;
  entryTargetDate: string | null;
  timeHorizonTargetDate: string | null;
  closeTargetDate: string | null;
  markPriceDate: string | null;
  createdAt: string | null;
  status: PredictionStatus;
};

type EodPredictionScanResult = {
  candidatePredictions: EodPredictionRecord[];
  predictionsNeedingWork: EodPredictionRecord[];
  predictionsToProcess: EodPredictionRecord[];
  scannedCandidatePredictions: number;
  hasMoreCandidatePredictions: boolean;
};

type PredictionScanLimit = number | null;

function getTwelveDataConfig(): { apiKey: string; apiUrl: string } {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("TWELVE_DATA_API_KEY is not configured.");
  }

  return {
    apiKey,
    apiUrl: (process.env.TWELVE_DATA_API_URL?.trim() || "https://api.twelvedata.com").replace(/\/$/, ""),
  };
}

function getEodhdConfig(): { apiToken: string; apiUrl: string; bucketName: string } | null {
  const apiToken = process.env.EODHD_API_TOKEN?.trim() ?? "";
  if (!apiToken) {
    return null;
  }

  const bucketName = process.env.EODHD_BULK_EOD_BUCKET?.trim() || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "";
  if (!bucketName) {
    throw new Error("EODHD_BULK_EOD_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET must be configured to cache EODHD bulk files.");
  }

  return {
    apiToken,
    apiUrl: (process.env.EODHD_API_URL?.trim() || "https://eodhd.com").replace(/\/$/, ""),
    bucketName,
  };
}

function readPredictionScanLimit(value: unknown): PredictionScanLimit {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(1, Math.floor(parsed));
}

function readRollForwardBatchSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ROLL_FORWARD_BATCH_SIZE;
  }
  return Math.max(1, Math.min(MAX_ROLL_FORWARD_BATCH_SIZE, Math.floor(parsed)));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function addUtcDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getCurrentEasternDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function eodRunDocId(runDate: string, market = DEFAULT_MARKET): string {
  return [market, runDate].join("_");
}

function resolveRunDate(value: string | undefined): string {
  const runDate = value?.trim() || getCurrentEasternDate();
  if (!isIsoDate(runDate)) {
    throw new Error("runDate must be a YYYY-MM-DD date.");
  }
  return runDate;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueTickers(tickers: string[]): string[] {
  return Array.from(new Set(tickers.map(normalizeTicker).filter(Boolean))).sort();
}

function eodPriceDocId(ticker: string, tradingDate: string, market = DEFAULT_MARKET): string {
  return [market, ticker, tradingDate].join("_");
}

function predictionDailyMarkDocId(predictionId: string, tradingDate: string): string {
  return [predictionId, tradingDate].join("_");
}

function userDailyScoreDocId(userId: string, tradingDate: string): string {
  return [userId, tradingDate].join("_");
}

function toCachedEodPrice(data: FirebaseFirestore.DocumentData | undefined): EodPrice | null {
  if (!data) {
    return null;
  }

  const ticker = typeof data.ticker === "string" ? normalizeTicker(data.ticker) : "";
  const requestedDate = typeof data.requestedDate === "string" ? data.requestedDate : "";
  const tradingDate = typeof data.tradingDate === "string" ? data.tradingDate : "";
  const open = toFiniteNumber(data.open);
  const high = toFiniteNumber(data.high);
  const low = toFiniteNumber(data.low);
  const close = toFiniteNumber(data.close);

  if (!ticker || !isIsoDate(requestedDate) || !isIsoDate(tradingDate) || open === null || high === null || low === null || close === null) {
    return null;
  }

  return {
    market: typeof data.market === "string" && data.market.trim() ? data.market : DEFAULT_MARKET,
    ticker,
    requestedDate,
    tradingDate,
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(data.volume),
    source: typeof data.source === "string" ? data.source : EOD_PRICE_SOURCE,
    providerSymbol: typeof data.providerSymbol === "string" ? data.providerSymbol : ticker,
    exchange: typeof data.exchange === "string" ? data.exchange : null,
    exchangeTimezone: typeof data.exchangeTimezone === "string" ? data.exchangeTimezone : null,
    micCode: typeof data.micCode === "string" ? data.micCode : null,
    loadedAt: typeof data.loadedAt === "string" ? data.loadedAt : new Date().toISOString(),
    isFinal: true,
    previousClose: toFiniteNumber(data.previousClose),
    previousTradingDate: typeof data.previousTradingDate === "string" ? data.previousTradingDate : null,
    dailyReturn: toFiniteNumber(data.dailyReturn),
  };
}

async function readCachedEodPrices(tickers: string[], tradingDate: string): Promise<Map<string, EodPrice>> {
  const db = getAdminFirestore();
  const cached = new Map<string, EodPrice>();

  await Promise.all(
    tickers.map(async (ticker) => {
      const snapshot = await db
        .collection("eod_prices")
        .doc(eodPriceDocId(ticker, tradingDate))
        .get();
      const price = snapshot.exists ? toCachedEodPrice(snapshot.data()) : null;
      if (price) {
        cached.set(ticker, price);
      }
    }),
  );

  return cached;
}

function parseTwelveDataPrice(
  ticker: string,
  requestedDate: string,
  loadedAt: string,
  payload: TwelveDataSymbolResponse | undefined,
): EodPrice | { ticker: string; reason: string } {
  if (!payload) {
    return { ticker, reason: "missing_symbol_response" };
  }

  if (payload.status && payload.status !== "ok") {
    return { ticker, reason: payload.message || payload.status };
  }

  const latest = payload.values?.[0];
  if (!latest?.datetime || !isIsoDate(latest.datetime)) {
    return { ticker, reason: "missing_trading_date" };
  }

  if (latest.datetime !== requestedDate) {
    return { ticker, reason: `trading_date_mismatch_${latest.datetime}` };
  }

  const open = toFiniteNumber(latest.open);
  const high = toFiniteNumber(latest.high);
  const low = toFiniteNumber(latest.low);
  const close = toFiniteNumber(latest.close);

  if (open === null || high === null || low === null || close === null || close <= 0) {
    return { ticker, reason: "invalid_ohlc" };
  }

  return {
    market: DEFAULT_MARKET,
    ticker,
    requestedDate,
    tradingDate: latest.datetime,
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(latest.volume),
    source: EOD_PRICE_SOURCE,
    providerSymbol: payload.meta?.symbol ?? ticker,
    exchange: payload.meta?.exchange ?? null,
    exchangeTimezone: payload.meta?.exchange_timezone ?? null,
    micCode: payload.meta?.mic_code ?? null,
    loadedAt,
    isFinal: true,
    previousClose: null,
    previousTradingDate: null,
    dailyReturn: null,
  };
}

function eodhdBulkGcsPath(market: string, requestedDate: string): string {
  return `${EODHD_BULK_GCS_PREFIX}/${market}/${requestedDate}.json`;
}

function parseEodhdBulkRows(rawJson: string): EodhdBulkEodRow[] {
  const payload = JSON.parse(rawJson) as unknown;
  if (!Array.isArray(payload)) {
    const message = typeof payload === "object" && payload !== null && "message" in payload
      ? String((payload as { message?: unknown }).message)
      : "unexpected_non_array_response";
    throw new Error(`EODHD bulk EOD response was not an array: ${message}`);
  }

  return payload as EodhdBulkEodRow[];
}

async function readTextFromGcs(bucketName: string, path: string): Promise<string | null> {
  const file = getAdminStorageBucket(bucketName).file(path);
  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }

  const [contents] = await file.download();
  return contents.toString("utf8");
}

async function writeTextToGcs(bucketName: string, path: string, contents: string): Promise<void> {
  const file = getAdminStorageBucket(bucketName).file(path);
  await file.save(contents, {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=31536000, immutable",
    },
  });
}

async function readEodhdBulkRows(
  requestedDate: string,
): Promise<{ rows: EodhdBulkEodRow[]; rawGcsPath: string; rawCacheHit: boolean } | null> {
  const config = getEodhdConfig();
  if (!config) {
    return null;
  }

  const rawGcsPath = eodhdBulkGcsPath(DEFAULT_MARKET, requestedDate);
  const cachedJson = await readTextFromGcs(config.bucketName, rawGcsPath);
  if (cachedJson) {
    return {
      rows: parseEodhdBulkRows(cachedJson),
      rawGcsPath,
      rawCacheHit: true,
    };
  }

  const url = new URL(`${config.apiUrl}/api/eod-bulk-last-day/${DEFAULT_MARKET}`);
  url.searchParams.set("api_token", config.apiToken);
  url.searchParams.set("date", requestedDate);
  url.searchParams.set("fmt", "json");

  const response = await fetch(url, { cache: "no-store" });
  const rawJson = await response.text();
  if (!response.ok) {
    throw new Error(`EODHD bulk EOD request failed with HTTP ${response.status}: ${rawJson.slice(0, 500)}`);
  }

  const rows = parseEodhdBulkRows(rawJson);
  await writeTextToGcs(config.bucketName, rawGcsPath, rawJson);

  return {
    rows,
    rawGcsPath,
    rawCacheHit: false,
  };
}

function parseEodhdBulkPrice(
  ticker: string,
  requestedDate: string,
  loadedAt: string,
  row: EodhdBulkEodRow | undefined,
): EodPrice | { ticker: string; reason: string } {
  if (!row) {
    return { ticker, reason: "missing_eodhd_bulk_row" };
  }

  const tradingDate = typeof row.date === "string" ? row.date : "";
  if (!isIsoDate(tradingDate)) {
    return { ticker, reason: "missing_trading_date" };
  }

  if (tradingDate !== requestedDate) {
    return { ticker, reason: `trading_date_mismatch_${tradingDate}` };
  }

  const open = toFiniteNumber(row.open);
  const high = toFiniteNumber(row.high);
  const low = toFiniteNumber(row.low);
  const close = toFiniteNumber(row.adjusted_close) ?? toFiniteNumber(row.close);

  if (open === null || high === null || low === null || close === null || close <= 0) {
    return { ticker, reason: "invalid_ohlc" };
  }

  const providerCode = typeof row.code === "string" && row.code.trim() ? row.code.trim() : ticker;
  const exchange = typeof row.exchange_short_name === "string" && row.exchange_short_name.trim()
    ? row.exchange_short_name.trim()
    : DEFAULT_MARKET;

  return {
    market: DEFAULT_MARKET,
    ticker,
    requestedDate,
    tradingDate,
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(row.volume),
    source: EODHD_BULK_EOD_PRICE_SOURCE,
    providerSymbol: `${providerCode}.${exchange}`,
    exchange,
    exchangeTimezone: null,
    micCode: null,
    loadedAt,
    isFinal: true,
    previousClose: null,
    previousTradingDate: null,
    dailyReturn: null,
  };
}

async function readPreviousEodPrice(
  db: FirebaseFirestore.Firestore,
  price: Pick<EodPrice, "market" | "ticker" | "tradingDate">,
): Promise<Pick<EodPrice, "close" | "tradingDate"> | null> {
  for (let offset = 1; offset <= PREVIOUS_EOD_PRICE_LOOKBACK_DAYS; offset += 1) {
    const previousDate = addUtcDays(price.tradingDate, -offset);
    const snapshot = await db
      .collection("eod_prices")
      .doc(eodPriceDocId(price.ticker, previousDate, price.market))
      .get();
    const previous = snapshot.exists ? toCachedEodPrice(snapshot.data()) : null;

    if (previous && previous.close > 0) {
      return {
        close: previous.close,
        tradingDate: previous.tradingDate,
      };
    }
  }

  return null;
}

async function withTickerDailyReturns(db: FirebaseFirestore.Firestore, prices: EodPrice[]): Promise<EodPrice[]> {
  return Promise.all(prices.map(async (price) => {
    const previous = await readPreviousEodPrice(db, price);
    if (!previous) {
      return {
        ...price,
        previousClose: null,
        previousTradingDate: null,
        dailyReturn: null,
      };
    }

    return {
      ...price,
      previousClose: previous.close,
      previousTradingDate: previous.tradingDate,
      dailyReturn: (price.close - previous.close) / previous.close,
    };
  }));
}

function directionAdjustedDailyReturn(direction: unknown, price: EodPrice): number | null {
  if (price.dailyReturn === null || !isPredictionDirection(direction)) {
    return null;
  }

  return direction === "UP" ? price.dailyReturn : -price.dailyReturn;
}

async function fetchTwelveDataEodPrices(
  tickers: string[],
  requestedDate: string,
  loadedAt: string,
): Promise<EodPriceFetchResult> {
  if (tickers.length === 0) {
    return {
      provider: EOD_PRICE_SOURCE,
      prices: [],
      failures: [],
      rawGcsPath: null,
      rawCacheHit: false,
    };
  }

  const config = getTwelveDataConfig();
  const prices: EodPrice[] = [];
  const failures: Array<{ ticker: string; reason: string }> = [];

  for (const tickerChunk of chunk(tickers, TWELVE_DATA_CHUNK_SIZE)) {
    const url = new URL(`${config.apiUrl}/time_series`);
    url.searchParams.set("symbol", tickerChunk.join(","));
    url.searchParams.set("interval", "1day");
    url.searchParams.set("start_date", `${requestedDate} 00:00:00`);
    url.searchParams.set("end_date", `${requestedDate} 23:59:59`);
    url.searchParams.set("apikey", config.apiKey);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      tickerChunk.forEach((ticker) => failures.push({ ticker, reason: `provider_http_${response.status}` }));
      continue;
    }

    const payload = (await response.json()) as TwelveDataBatchResponse | TwelveDataSymbolResponse;
    const byTicker = tickerChunk.length === 1 && "values" in payload
      ? { [tickerChunk[0]]: payload as TwelveDataSymbolResponse }
      : payload as TwelveDataBatchResponse;

    tickerChunk.forEach((ticker) => {
      const parsed = parseTwelveDataPrice(ticker, requestedDate, loadedAt, byTicker[ticker]);
      if ("reason" in parsed) {
        failures.push(parsed);
      } else {
        prices.push(parsed);
      }
    });
  }

  return {
    provider: EOD_PRICE_SOURCE,
    prices,
    failures,
    rawGcsPath: null,
    rawCacheHit: false,
  };
}

async function fetchEodhdBulkEodPrices(
  tickers: string[],
  requestedDate: string,
  loadedAt: string,
): Promise<EodPriceFetchResult | null> {
  if (tickers.length === 0) {
    return {
      provider: EODHD_BULK_EOD_PRICE_SOURCE,
      prices: [],
      failures: [],
      rawGcsPath: null,
      rawCacheHit: false,
    };
  }

  const bulk = await readEodhdBulkRows(requestedDate);
  if (!bulk) {
    return null;
  }

  const rowsByTicker = new Map<string, EodhdBulkEodRow>();
  bulk.rows.forEach((row) => {
    if (typeof row.code === "string") {
      const ticker = normalizeTicker(row.code);
      if (ticker) {
        rowsByTicker.set(ticker, row);
      }
    }
  });

  const prices: EodPrice[] = [];
  const failures: Array<{ ticker: string; reason: string }> = [];
  tickers.forEach((ticker) => {
    const parsed = parseEodhdBulkPrice(ticker, requestedDate, loadedAt, rowsByTicker.get(ticker));
    if ("reason" in parsed) {
      failures.push(parsed);
    } else {
      prices.push(parsed);
    }
  });

  return {
    provider: EODHD_BULK_EOD_PRICE_SOURCE,
    prices,
    failures,
    rawGcsPath: bulk.rawGcsPath,
    rawCacheHit: bulk.rawCacheHit,
  };
}

async function fetchEodPrices(
  tickers: string[],
  requestedDate: string,
  loadedAt: string,
): Promise<EodPriceFetchResult> {
  try {
    const eodhd = await fetchEodhdBulkEodPrices(tickers, requestedDate, loadedAt);
    if (eodhd) {
      return eodhd;
    }
  } catch (error) {
    console.warn("[daily-eod-maintenance] EODHD bulk EOD load failed; falling back to Twelve Data", {
      requestedDate,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return fetchTwelveDataEodPrices(tickers, requestedDate, loadedAt);
}

async function readRollForwardDates(
  db: FirebaseFirestore.Firestore,
  startDate: string,
  maxDates: number,
): Promise<string[]> {
  const dates = new Set<string>([startDate]);
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query = db
      .collection("eod_prices")
      .where("tradingDate", ">=", startDate)
      .orderBy("tradingDate", "asc")
      .limit(ROLL_FORWARD_PRICE_SCAN_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      const tradingDate = doc.get("tradingDate");
      if (typeof tradingDate === "string" && isIsoDate(tradingDate)) {
        dates.add(tradingDate);
        if (dates.size >= maxDates) {
          return Array.from(dates).sort();
        }
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
    if (snapshot.size < ROLL_FORWARD_PRICE_SCAN_PAGE_SIZE) {
      break;
    }
  }

  return Array.from(dates).sort();
}

function isProcessableStatus(value: unknown): boolean {
  return canonicalPredictionStatus(value) !== null || value === "OPENING" || value === "CLOSING" || value === "CLOSED";
}

function timeHorizonTargetDateFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const targetDate = (value as Record<string, unknown>).targetDate;
  return typeof targetDate === "string" && isIsoDate(targetDate) ? targetDate : null;
}

function isOpenUntilDue(prediction: EodPredictionRecord, runDate: string): boolean {
  return prediction.status === "OPEN" &&
    typeof prediction.timeHorizonTargetDate === "string" &&
    prediction.timeHorizonTargetDate <= runDate;
}

function isLatestOpenUntilDue(latest: Record<string, unknown>, runDate: string): boolean {
  const targetDate = timeHorizonTargetDateFromValue(latest.timeHorizon);
  return canonicalPredictionStatus(latest.status) === "OPEN" && typeof targetDate === "string" && targetDate <= runDate;
}

function toEodPredictionRecord(snapshot: FirebaseFirestore.QueryDocumentSnapshot): EodPredictionRecord | null {
  const data = snapshot.data() as Record<string, unknown>;
  const ticker = typeof data.ticker === "string" ? normalizeTicker(data.ticker) : "";
  const userId = typeof data.userId === "string" ? data.userId : "";
  const markPriceDate = typeof data.markPriceDate === "string" ? data.markPriceDate : null;
  const entryDate = typeof data.entryDate === "string" ? data.entryDate : null;
  const entryTargetDate = typeof data.entryTargetDate === "string" ? data.entryTargetDate : null;
  const timeHorizonTargetDate = timeHorizonTargetDateFromValue(data.timeHorizon);
  const closeTargetDate = typeof data.closeTargetDate === "string" ? data.closeTargetDate : null;
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : null;
  const entryPrice = data.entryPrice === null || data.entryPrice === undefined ? null : Number(data.entryPrice);
  const status = canonicalPredictionStatus(data.status);

  if (!ticker || !userId || !isProcessableStatus(data.status) || !status) {
    return null;
  }

  if (entryPrice !== null && (!Number.isFinite(entryPrice) || entryPrice <= 0)) {
    return null;
  }

  return {
    ref: snapshot.ref,
    id: snapshot.id,
    userId,
    ticker,
    storedStatus: typeof data.status === "string" ? data.status : status,
    direction: data.direction,
    entryPrice,
    entryDate,
    entryTargetDate,
    timeHorizonTargetDate,
    closeTargetDate,
    markPriceDate,
    createdAt,
    status,
  };
}

function computeMark(
  direction: unknown,
  entryPrice: number,
  markPrice: number,
): { returnValue: number; score: number; outcome: number; xpEarned: number } | null {
  if (!isPredictionDirection(direction)) {
    return null;
  }

  const returnValue = computePredictionReturn(direction, entryPrice, markPrice);
  const score = computePredictionScore(returnValue);
  return {
    returnValue,
    score,
    outcome: computePredictionOutcome(returnValue),
    xpEarned: computePredictionXp(score),
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMarkUpdate(
  price: EodPrice,
  mark: { returnValue: number; score: number; outcome: number; xpEarned: number },
  scoreAppliedToUser: boolean,
  nowIso: string,
) {
  return {
    updatedAt: nowIso,
    markPrice: price.close,
    markPriceSource: price.source,
    markPriceDate: price.tradingDate,
    markPriceCapturedAt: price.loadedAt,
    markReturnValue: mark.returnValue,
    markScore: mark.score,
    markPredictionScore: mark.score,
    scoreAppliedToUser,
  };
}

function buildResult(
  price: EodPrice,
  mark: { returnValue: number; score: number; outcome: number; xpEarned: number },
): PredictionResult {
  return {
    exitPrice: price.close,
    exitPriceSource: price.source,
    returnValue: mark.returnValue,
    score: mark.score,
    predictionScore: mark.score,
    outcome: mark.outcome,
    xpEarned: mark.xpEarned,
  };
}

function dailySnapshotStatus(prediction: EodPredictionRecord, tradingDate: string): PredictionStatus {
  if (prediction.status === "SETTLED" && prediction.markPriceDate !== tradingDate) {
    return "OPEN";
  }

  if (isOpenUntilDue(prediction, tradingDate)) {
    return "SETTLED";
  }

  if (prediction.storedStatus === "CLOSING" && prediction.closeTargetDate && prediction.closeTargetDate <= tradingDate) {
    return "SETTLED";
  }

  return prediction.status;
}

function existingDailyPreviousScore(
  data: FirebaseFirestore.DocumentData | undefined,
  fallbackPreviousScore: number | null,
): number | null {
  const previousScore = finiteNumberOrNull(data?.previousScore);
  if (previousScore !== null) {
    return previousScore;
  }

  const score = finiteNumberOrNull(data?.score);
  const scoreChange = finiteNumberOrNull(data?.scoreChange);
  if (score !== null && scoreChange !== null) {
    return score - scoreChange;
  }

  return fallbackPreviousScore;
}

function existingDailyPreviousReturnValue(
  data: FirebaseFirestore.DocumentData | undefined,
  fallbackPreviousReturnValue: number | null,
): number | null {
  const previousReturnValue = finiteNumberOrNull(data?.previousReturnValue);
  if (previousReturnValue !== null) {
    return previousReturnValue;
  }

  const returnValue = finiteNumberOrNull(data?.markReturnValue);
  const returnValueChange = finiteNumberOrNull(data?.returnValueChange);
  if (returnValue !== null && returnValueChange !== null) {
    return returnValue - returnValueChange;
  }

  return fallbackPreviousReturnValue;
}

function markSummaryFromDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): {
  predictionId: string;
  ticker: string | null;
  status: PredictionStatus | null;
  score: number;
  scoreChange: number;
  returnValue: number;
} | null {
  const data = doc.data();
  const predictionId = typeof data.predictionId === "string" ? data.predictionId : "";
  const score = finiteNumberOrNull(data.score);
  const scoreChange = finiteNumberOrNull(data.scoreChange);
  const returnValue = finiteNumberOrNull(data.markReturnValue);
  const scoreAppliedToUser = data.scoreAppliedToUser !== false && data.visibility !== "PRIVATE";

  if (!predictionId || score === null || scoreChange === null || returnValue === null || !scoreAppliedToUser) {
    return null;
  }

  return {
    predictionId,
    ticker: typeof data.ticker === "string" ? data.ticker : null,
    status: canonicalPredictionStatus(data.status),
    score,
    scoreChange,
    returnValue,
  };
}

function countMarksByStatus(
  marks: Array<{ status: PredictionStatus | null }>,
  statuses: PredictionStatus[],
): number {
  return marks.filter((mark) => mark.status && statuses.includes(mark.status)).length;
}

function userStatsCounter(data: FirebaseFirestore.DocumentData | undefined, key: string): number {
  const stats = (data?.stats as Record<string, unknown> | undefined) ?? {};
  const parsed = Number(stats[key]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function userStatsCounterUpdates(
  data: FirebaseFirestore.DocumentData | undefined,
  deltas: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(deltas).map(([key, delta]) => [
      `stats.${key}`,
      Math.max(0, userStatsCounter(data, key) + delta),
    ]),
  );
}

async function readPreviousPredictionDailyScore(
  db: FirebaseFirestore.Firestore,
  predictionId: string,
  tradingDate: string,
): Promise<{ score: number | null; returnValue: number | null }> {
  const snapshot = await db
    .collection("prediction_daily_marks")
    .where("predictionId", "==", predictionId)
    .where("date", "<", tradingDate)
    .orderBy("date", "desc")
    .limit(1)
    .get();

  if (snapshot.empty) {
    return { score: null, returnValue: null };
  }

  return {
    score: finiteNumberOrNull(snapshot.docs[0].get("score")),
    returnValue: finiteNumberOrNull(snapshot.docs[0].get("markReturnValue")),
  };
}

async function writeUserDailyScoreSnapshots(
  db: FirebaseFirestore.Firestore,
  userIds: string[],
  tradingDate: string,
  nowIso: string,
): Promise<{ userScores: number; skippedUsers: number }> {
  let userScores = 0;
  let skippedUsers = 0;

  for (const userId of userIds) {
    const userDailyRef = db.collection("user_daily_scores").doc(userDailyScoreDocId(userId, tradingDate));
    const [userSnapshot, existingDailySnapshot, dailyMarkSnapshot, marksAsOfDateSnapshot, previousDailySnapshot] = await Promise.all([
      db.collection("users").doc(userId).get(),
      userDailyRef.get(),
      db.collection("prediction_daily_marks")
        .where("userId", "==", userId)
        .where("date", "==", tradingDate)
        .get(),
      db.collection("prediction_daily_marks")
        .where("userId", "==", userId)
        .where("date", "<=", tradingDate)
        .orderBy("date", "asc")
        .get(),
      db.collection("user_daily_scores")
        .where("userId", "==", userId)
        .where("date", "<", tradingDate)
        .orderBy("date", "desc")
        .limit(1)
        .get(),
    ]);

    if (!userSnapshot.exists) {
      skippedUsers += 1;
      continue;
    }

    const previousTotalScore = previousDailySnapshot.empty
      ? null
      : finiteNumberOrNull(previousDailySnapshot.docs[0].get("totalScore"));
    const previousTotalXP = previousDailySnapshot.empty
      ? null
      : finiteNumberOrNull(previousDailySnapshot.docs[0].get("totalXP"));
    const dailyMarks = dailyMarkSnapshot.docs
      .map(markSummaryFromDoc)
      .filter((mark): mark is NonNullable<ReturnType<typeof markSummaryFromDoc>> => mark !== null);
    const latestMarksByPredictionId = new Map<string, NonNullable<ReturnType<typeof markSummaryFromDoc>>>();
    for (const doc of marksAsOfDateSnapshot.docs) {
      const mark = markSummaryFromDoc(doc);
      if (mark) {
        latestMarksByPredictionId.set(mark.predictionId, mark);
      }
    }
    const aggregateMarks = Array.from(latestMarksByPredictionId.values());
    const settledCalls = countMarksByStatus(aggregateMarks, ["SETTLED"]);
    const analyticsByMark = aggregateMarks.map((mark) => ({
      status: mark.status,
      analytics: {
        returnValue: mark.returnValue,
        predictionScore: mark.score,
        outcome: computePredictionOutcome(mark.returnValue),
        xpEarned: computePredictionXp(mark.score),
      },
    }));
    const analytics = computeUserAnalytics(
      aggregateMarks.length,
      analyticsByMark.map((mark) => mark.analytics),
      settledCalls,
      analyticsByMark.filter((mark) => mark.status === "SETTLED").map((mark) => mark.analytics),
    );
    const totalScore = analytics.score;
    const totalCalls = analytics.totalCalls;
    const totalXP = analytics.totalXP;
    const level = analytics.level;
    const avgPredictionScore = analytics.avgPredictionScore;
    const consistency = analytics.consistency;
    const coverage = analytics.coverage;
    const avgReturn = analytics.avgReturn;
    const winRate = analytics.winRate;
    const eligibleForLeaderboard = analytics.eligibleForLeaderboard;
    const dailyScoreChange = totalScore - (previousTotalScore ?? 0);
    const dailyXPChange = totalXP - (previousTotalXP ?? 0);
    const bestMark = dailyMarks.reduce<typeof dailyMarks[number] | null>(
      (best, mark) => (!best || mark.scoreChange > best.scoreChange ? mark : best),
      null,
    );
    const worstMark = dailyMarks.reduce<typeof dailyMarks[number] | null>(
      (worst, mark) => (!worst || mark.scoreChange < worst.scoreChange ? mark : worst),
      null,
    );
    const openingPredictions = countMarksByStatus(aggregateMarks, ["CREATED"]);
    const openPredictions = countMarksByStatus(aggregateMarks, ["OPEN"]);
    const closingPredictions = 0;
    const closedPredictions = countMarksByStatus(aggregateMarks, ["SETTLED"]);

    await userDailyRef.set({
      userId,
      date: tradingDate,
      totalScore,
      previousTotalScore,
      dailyScoreChange,
      totalCalls,
      settledCalls,
      totalXP,
      previousTotalXP,
      dailyXPChange,
      level,
      avgPredictionScore,
      consistency,
      coverage,
      avgReturn,
      winRate,
      eligibleForLeaderboard,
      totalPredictions: aggregateMarks.length,
      openingPredictions,
      openPredictions,
      closingPredictions,
      closedPredictions,
      canceledPredictions: 0,
      dailyMarkedPredictions: dailyMarks.length,
      bestPredictionId: bestMark?.predictionId ?? null,
      bestPredictionTicker: bestMark?.ticker ?? null,
      bestPredictionScore: bestMark?.score ?? null,
      bestPredictionScoreChange: bestMark?.scoreChange ?? null,
      worstPredictionId: worstMark?.predictionId ?? null,
      worstPredictionTicker: worstMark?.ticker ?? null,
      worstPredictionScore: worstMark?.score ?? null,
      worstPredictionScoreChange: worstMark?.scoreChange ?? null,
      createdAt: existingDailySnapshot.get("createdAt") ?? nowIso,
      updatedAt: nowIso,
    }, { merge: true });

    userScores += 1;
  }

  return { userScores, skippedUsers };
}

function isActionablePrediction(prediction: EodPredictionRecord, runDate: string, manualTickers: string[]): boolean {
  if (manualTickers.length > 0 && !manualTickers.includes(prediction.ticker)) {
    return false;
  }

  if (prediction.status === "CREATED") {
    return typeof prediction.entryTargetDate === "string" && prediction.entryTargetDate <= runDate;
  }

  if (prediction.storedStatus === "CLOSING") {
    return typeof prediction.closeTargetDate === "string" && prediction.closeTargetDate <= runDate;
  }

  if (prediction.status === "SETTLED") {
    return false;
  }

  if (isOpenUntilDue(prediction, runDate)) {
    return true;
  }

  return prediction.markPriceDate !== runDate && (!prediction.markPriceDate || prediction.markPriceDate < runDate);
}

function shouldMutateLivePrediction(prediction: EodPredictionRecord, runDate: string, manualTickers: string[]): boolean {
  if (manualTickers.length > 0 && !manualTickers.includes(prediction.ticker)) {
    return false;
  }

  if (prediction.status === "CREATED") {
    return typeof prediction.entryTargetDate === "string" && prediction.entryTargetDate <= runDate;
  }

  if (prediction.storedStatus === "CLOSING") {
    return typeof prediction.closeTargetDate === "string" && prediction.closeTargetDate <= runDate;
  }

  if (prediction.status === "SETTLED") {
    return prediction.markPriceDate === runDate;
  }

  return isOpenUntilDue(prediction, runDate) || !prediction.markPriceDate || prediction.markPriceDate <= runDate;
}

function isDailySnapshotCandidate(prediction: EodPredictionRecord, runDate: string, manualTickers: string[]): boolean {
  if (manualTickers.length > 0 && !manualTickers.includes(prediction.ticker)) {
    return false;
  }

  if (prediction.entryPrice === null || typeof prediction.entryDate !== "string" || prediction.entryDate > runDate) {
    return false;
  }

  if (prediction.status === "SETTLED") {
    return typeof prediction.markPriceDate === "string" && prediction.markPriceDate >= runDate;
  }

  return prediction.status === "OPEN" || prediction.storedStatus === "CLOSING";
}

async function scanEodPredictions(
  db: FirebaseFirestore.Firestore,
  runDate: string,
  limit: PredictionScanLimit,
  manualTickers: string[],
): Promise<EodPredictionScanResult> {
  const candidatePredictions: EodPredictionRecord[] = [];
  const predictionsNeedingWork: EodPredictionRecord[] = [];
  const predictionsToProcess: EodPredictionRecord[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scannedCandidatePredictions = 0;
  let hasMoreCandidatePredictions = false;

  while (limit === null || predictionsToProcess.length < limit) {
    let stoppedByLimit = false;
    let query = db
      .collection("predictions")
      .where("status", "in", ["CREATED", "OPEN", "SETTLED", "OPENING", "CLOSING", "CLOSED"])
      .orderBy("__name__")
      .limit(POSITION_SCAN_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      hasMoreCandidatePredictions = false;
      break;
    }

    scannedCandidatePredictions += snapshot.size;

    for (const doc of snapshot.docs) {
      const prediction = toEodPredictionRecord(doc);
      if (!prediction) {
        continue;
      }

      candidatePredictions.push(prediction);

      const isActionable = isActionablePrediction(prediction, runDate, manualTickers);
      const needsDailySnapshot = isDailySnapshotCandidate(prediction, runDate, manualTickers);

      if (isActionable) {
        predictionsNeedingWork.push(prediction);
      }

      if (isActionable || needsDailySnapshot) {
        predictionsToProcess.push(prediction);
        if (limit !== null && predictionsToProcess.length >= limit) {
          stoppedByLimit = true;
          break;
        }
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
    hasMoreCandidatePredictions = stoppedByLimit || snapshot.size === POSITION_SCAN_PAGE_SIZE;

    if (stoppedByLimit || !hasMoreCandidatePredictions) {
      break;
    }
  }

  return {
    candidatePredictions,
    predictionsNeedingWork,
    predictionsToProcess,
    scannedCandidatePredictions,
    hasMoreCandidatePredictions,
  };
}

export async function runDailyEodMaintenance(
  input: DailyEodMaintenanceInput = {},
): Promise<DailyEodMaintenanceResult> {
  const db = getAdminFirestore();
  const dryRun = input.dryRun === true;
  const recompute = input.recompute === true;
  const loadPrices = input.loadPrices !== false;
  const markPredictions = input.markPredictions !== false;
  const runDate = resolveRunDate(input.runDate);
  const limit = readPredictionScanLimit(input.limit);
  const nowIso = new Date().toISOString();
  const manualTickers = input.tickers?.length ? uniqueTickers(input.tickers) : [];

  if (input.rollForward === true) {
    const rollForwardBatchSize = readRollForwardBatchSize(input.rollForwardBatchSize);
    const availableRunDates = await readRollForwardDates(db, runDate, rollForwardBatchSize + 1);
    const runDates = availableRunDates.slice(0, rollForwardBatchSize);
    const nextRunDate = availableRunDates.at(rollForwardBatchSize) ?? null;
    const results: DailyEodMaintenanceResult[] = [];

    for (const nextRunDate of runDates) {
      results.push(await runDailyEodMaintenance({
        ...input,
        runDate: nextRunDate,
        rollForward: false,
      }));
    }

    const lastResult = results.at(-1);
    if (!lastResult) {
      throw new Error("No EOD dates found for roll-forward run.");
    }

    return {
      ...lastResult,
      rollForward: {
        startDate: runDate,
        endDate: runDates.at(-1) ?? null,
        runDates,
        hasMore: nextRunDate !== null,
        nextRunDate,
      },
    };
  }

  const runRef = db.collection("eod_runs").doc(eodRunDocId(runDate));

  console.info("[daily-eod-maintenance] Starting run", {
    runDate,
    dryRun,
    recompute,
    loadPrices,
    markPredictions,
    limit,
    manualTickers,
  });

  if (!dryRun) {
    await runRef.set({
      market: DEFAULT_MARKET,
      runDate,
      status: "STARTED",
      startedAt: nowIso,
      completedAt: null,
      failedAt: null,
      error: null,
      recompute,
    }, { merge: true });
  }

  try {
    const {
      candidatePredictions,
      predictionsNeedingWork,
      predictionsToProcess,
      scannedCandidatePredictions,
      hasMoreCandidatePredictions,
    } = await scanEodPredictions(db, runDate, limit, manualTickers);
    const requestedTickers = manualTickers.length > 0
      ? manualTickers
      : uniqueTickers(predictionsToProcess.map((item) => item.ticker));

    console.info("[daily-eod-maintenance] Prediction scan completed", {
      runDate,
      candidatePredictions: candidatePredictions.length,
      actionablePredictions: predictionsNeedingWork.length,
      predictionsToProcess: predictionsToProcess.length,
      scannedCandidatePredictions,
      hasMoreCandidatePredictions,
      requestedTickers,
    });

    const priceLoad: DailyEodMaintenanceResult["priceLoad"] = {
      provider: null,
      rawGcsPath: null,
      rawCacheHit: false,
      requestedTickers: requestedTickers.length,
      cacheHits: 0,
      loaded: 0,
      failed: 0,
      skipped: loadPrices ? candidatePredictions.length - predictionsToProcess.length : requestedTickers.length,
      prices: [],
      failures: [],
    };

    const priceByTicker = new Map<string, EodPrice>();

    if (loadPrices && requestedTickers.length > 0) {
      console.info("[daily-eod-maintenance] Loading EOD prices", {
        runDate,
        requestedTickers,
      });

      const cachedPrices = await readCachedEodPrices(requestedTickers, runDate);
      cachedPrices.forEach((price, ticker) => {
        priceByTicker.set(ticker, price);
      });
      priceLoad.cacheHits = cachedPrices.size;

      const tickersToFetch = requestedTickers.filter((ticker) => !cachedPrices.has(ticker));
      const fetched = await fetchEodPrices(tickersToFetch, runDate, nowIso);
      const loadedPrices = await withTickerDailyReturns(db, [...cachedPrices.values(), ...fetched.prices]);
      priceLoad.provider = fetched.provider;
      priceLoad.rawGcsPath = fetched.rawGcsPath;
      priceLoad.rawCacheHit = fetched.rawCacheHit;
      priceLoad.loaded = fetched.prices.length;
      priceLoad.failed = fetched.failures.length;
      priceLoad.prices = loadedPrices.map((price) => ({
        ticker: price.ticker,
        tradingDate: price.tradingDate,
        close: price.close,
        previousClose: price.previousClose,
        previousTradingDate: price.previousTradingDate,
        dailyReturn: price.dailyReturn,
        source: price.source,
      }));
      priceLoad.failures = fetched.failures;

      console.info("[daily-eod-maintenance] EOD price load completed", {
        runDate,
        requestedTickers: requestedTickers.length,
        cacheHits: priceLoad.cacheHits,
        tickersFetched: tickersToFetch.length,
        provider: priceLoad.provider,
        rawGcsPath: priceLoad.rawGcsPath,
        rawCacheHit: priceLoad.rawCacheHit,
        loaded: priceLoad.loaded,
        failed: priceLoad.failed,
        prices: priceLoad.prices,
        failures: priceLoad.failures,
      });

      for (const price of loadedPrices) {
        priceByTicker.set(price.ticker, price);
        if (!dryRun) {
          await db
            .collection("eod_prices")
            .doc(eodPriceDocId(price.ticker, price.tradingDate, price.market))
            .set(price, { merge: true });
        }
      }
    } else {
      console.info("[daily-eod-maintenance] EOD price load skipped", {
        runDate,
        loadPrices,
        requestedTickers: requestedTickers.length,
      });
    }

    const latestTradingDate = Array.from(priceByTicker.values())
      .map((price) => price.tradingDate)
      .sort()
      .at(-1) ?? null;
    const marking: DailyEodMaintenanceResult["marking"] = {
      checked: markPredictions ? predictionsToProcess.length : 0,
      opened: 0,
      marked: 0,
      closed: 0,
      missingPrice: 0,
      skipped: 0,
    };
    const dailySnapshots: DailyEodMaintenanceResult["dailySnapshots"] = {
      predictionMarks: 0,
      userScores: 0,
      skippedUsers: 0,
    };
    const usersNeedingDailyScores = new Set<string>();
    const usersNeedingAnalytics = new Set<string>();

    if (markPredictions) {
      for (const prediction of predictionsToProcess) {
        const price = priceByTicker.get(prediction.ticker);
        if (!price) {
          marking.missingPrice += 1;
          console.warn("[daily-eod-maintenance] Missing EOD price for prediction", {
            runDate,
            predictionId: prediction.id,
            ticker: prediction.ticker,
            status: prediction.status,
          });
          continue;
        }

        if (dryRun) {
          const mutatesLiveScore = shouldMutateLivePrediction(prediction, runDate, manualTickers);
          if (!mutatesLiveScore) {
            dailySnapshots.predictionMarks += 1;
          } else if (prediction.status === "CREATED") {
            marking.opened += 1;
          } else if (prediction.storedStatus === "CLOSING" || isOpenUntilDue(prediction, runDate)) {
            marking.marked += 1;
            marking.closed += 1;
          } else {
            marking.marked += 1;
          }
          continue;
        }

        await db.runTransaction(async (tx) => {
          const predictionSnapshot = await tx.get(prediction.ref);

          if (!predictionSnapshot.exists) {
            marking.skipped += 1;
            console.warn("[daily-eod-maintenance] Skipped prediction because prediction doc is missing", {
              runDate,
              predictionId: prediction.id,
            });
            return;
          }

          const latest = predictionSnapshot.data() as Record<string, unknown>;
          const latestStatus = latest.status;
          const canonicalLatestStatus = canonicalPredictionStatus(latestStatus);
          if (
            latestStatus !== prediction.storedStatus ||
            !isProcessableStatus(latestStatus) ||
            !canonicalLatestStatus
          ) {
            marking.skipped += 1;
            console.warn("[daily-eod-maintenance] Skipped prediction because status changed", {
              runDate,
              predictionId: prediction.id,
              status: latestStatus,
            });
            return;
          }

          const shouldMutatePrediction = shouldMutateLivePrediction(prediction, runDate, manualTickers);
          const shouldCloseForOpenUntil = shouldMutatePrediction && isLatestOpenUntilDue(latest, runDate);
          if (canonicalLatestStatus === "CREATED") {
            const dailyMarkRef = db
              .collection("prediction_daily_marks")
              .doc(predictionDailyMarkDocId(prediction.id, price.tradingDate));
            const userRef = db.collection("users").doc(prediction.userId);
            const [dailyMarkSnapshot, userSnapshot] = await Promise.all([
              tx.get(dailyMarkRef),
              tx.get(userRef),
            ]);

            tx.update(prediction.ref, {
              updatedAt: nowIso,
              status: "OPEN",
              entryPrice: price.close,
              entryPriceSource: price.source,
              entryDate: price.tradingDate,
              entryTime: "16:00:00",
              entryCapturedAt: price.loadedAt,
            });
            tx.update(userRef, {
              updatedAt: nowIso,
              ...userStatsCounterUpdates(userSnapshot.data(), {
                openingPredictions: -1,
                openPredictions: 1,
              }),
            });
            tx.set(dailyMarkRef, {
              predictionId: prediction.id,
              predictionCreatedAt: prediction.createdAt,
              userId: prediction.userId,
              ticker: prediction.ticker,
              visibility: latest.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
              direction: latest.direction,
              date: price.tradingDate,
              runDate,
              status: "OPEN",
              entryPrice: price.close,
              markPrice: price.close,
              markPriceSource: price.source,
              markPriceDate: price.tradingDate,
              markPriceCapturedAt: price.loadedAt,
              markReturnValue: 0,
              markScore: 0,
              markPredictionScore: 0,
              score: 0,
              scoreAppliedToUser: latest.visibility === "PUBLIC",
              previousScore: 0,
              scoreChange: 0,
              previousReturnValue: 0,
              returnValueChange: 0,
              tickerDailyReturn: price.dailyReturn,
              directionDailyReturn: directionAdjustedDailyReturn(latest.direction, price),
              isClosed: false,
              createdAt: dailyMarkSnapshot.get("createdAt") ?? nowIso,
              updatedAt: nowIso,
            }, { merge: true });
            marking.opened += 1;
            dailySnapshots.predictionMarks += 1;
            usersNeedingDailyScores.add(prediction.userId);
            usersNeedingAnalytics.add(prediction.userId);
            return;
          }

          const storedEntryPrice = Number(latest.entryPrice);
          const entryPrice = prediction.entryDate === price.tradingDate ? price.close : storedEntryPrice;
          const mark = computeMark(latest.direction, entryPrice, price.close);
          if (!mark) {
            marking.skipped += 1;
            console.warn("[daily-eod-maintenance] Skipped prediction with invalid mark inputs", {
              runDate,
              predictionId: prediction.id,
              ticker: prediction.ticker,
              direction: latest.direction,
              entryPrice,
            });
            return;
          }

            const entryUpdate = prediction.entryDate === price.tradingDate
              ? {
                  entryPrice: price.close,
                  entryPriceSource: price.source,
                  entryCapturedAt: price.loadedAt,
                }
              : {};
            const scoreAppliedToUser = latest.visibility === "PUBLIC";
            const markUpdate = buildMarkUpdate(price, mark, scoreAppliedToUser, nowIso);
            const previousDaily = await readPreviousPredictionDailyScore(db, prediction.id, price.tradingDate);
          const dailyMarkRef = db
            .collection("prediction_daily_marks")
            .doc(predictionDailyMarkDocId(prediction.id, price.tradingDate));
          const dailyMarkSnapshot = await tx.get(dailyMarkRef);
          const userRef = db.collection("users").doc(prediction.userId);
          const needsUserCounterUpdate = latestStatus === "CLOSING" || shouldCloseForOpenUntil;
          const userSnapshot = needsUserCounterUpdate
            ? await tx.get(userRef)
            : null;
          const previousScoreValue = recompute
            ? previousDaily.score
            : existingDailyPreviousScore(
                dailyMarkSnapshot.data(),
                previousDaily.score,
              );
          const previousReturnValueValue = recompute
            ? previousDaily.returnValue
            : existingDailyPreviousReturnValue(
                dailyMarkSnapshot.data(),
                previousDaily.returnValue,
              );
          const isOpeningDailyMark = prediction.entryDate === price.tradingDate;
          const previousScore = previousScoreValue ?? (isOpeningDailyMark ? 0 : null);
          const previousReturnValue = previousReturnValueValue ?? (isOpeningDailyMark ? 0 : null);
          const isMissingPreviousDailyScore = previousScore === null;
          const isMissingPreviousDailyReturn = previousReturnValue === null && prediction.entryDate !== price.tradingDate;
          const dailyScoreChange = previousScore === null
            ? null
            : mark.score - previousScore;
          const dailyReturnValueChange = previousReturnValue === null
            ? null
            : mark.returnValue - previousReturnValue;
          const snapshotStatus = dailySnapshotStatus(prediction, price.tradingDate);
          const nextStatus = ((latestStatus === "CLOSING") && shouldMutatePrediction) || shouldCloseForOpenUntil
            ? "SETTLED"
            : snapshotStatus;
            tx.set(dailyMarkRef, {
              predictionId: prediction.id,
              predictionCreatedAt: prediction.createdAt,
              userId: prediction.userId,
              ticker: prediction.ticker,
              visibility: latest.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
              direction: latest.direction,
              date: price.tradingDate,
              runDate,
            status: nextStatus,
            entryPrice,
            markPrice: price.close,
            markPriceSource: price.source,
            markPriceDate: price.tradingDate,
            markPriceCapturedAt: price.loadedAt,
            markReturnValue: mark.returnValue,
            markScore: mark.score,
              markPredictionScore: mark.score,
              score: mark.score,
              scoreAppliedToUser,
              previousScore,
            scoreChange: dailyScoreChange,
            isMissingPreviousDailyScore,
            previousReturnValue,
            returnValueChange: dailyReturnValueChange,
            isMissingPreviousDailyReturn,
            tickerDailyReturn: price.dailyReturn,
            directionDailyReturn: directionAdjustedDailyReturn(latest.direction, price),
            isClosed: nextStatus === "SETTLED",
            createdAt: dailyMarkSnapshot.get("createdAt") ?? nowIso,
            updatedAt: nowIso,
          }, { merge: true });

          if (!shouldMutatePrediction) {
            if (Object.keys(entryUpdate).length > 0) {
              tx.update(prediction.ref, {
                updatedAt: nowIso,
                ...entryUpdate,
              });
            }
            dailySnapshots.predictionMarks += 1;
            usersNeedingDailyScores.add(prediction.userId);
            usersNeedingAnalytics.add(prediction.userId);
            return;
          }

          if (latestStatus === "CLOSING") {
            const result = buildResult(price, mark);
            tx.update(prediction.ref, {
              ...markUpdate,
              ...entryUpdate,
              status: "SETTLED",
              closedAt: nowIso,
              predictionScore: mark.score,
              outcome: mark.outcome,
              xpEarned: mark.xpEarned,
              result,
            });
            tx.update(userRef, {
              updatedAt: nowIso,
              ...userStatsCounterUpdates(userSnapshot?.data(), {
                closingPredictions: -1,
                closedPredictions: 1,
              }),
            });
            marking.marked += 1;
            marking.closed += 1;
            dailySnapshots.predictionMarks += 1;
            usersNeedingDailyScores.add(prediction.userId);
            usersNeedingAnalytics.add(prediction.userId);
            return;
          }

          if (shouldCloseForOpenUntil) {
            const result = buildResult(price, mark);
            tx.update(prediction.ref, {
              ...markUpdate,
              ...entryUpdate,
              status: "SETTLED",
              closeTargetDate: price.tradingDate,
              closedAt: nowIso,
              predictionScore: mark.score,
              outcome: mark.outcome,
              xpEarned: mark.xpEarned,
              result,
            });
            tx.update(userRef, {
              updatedAt: nowIso,
              ...userStatsCounterUpdates(userSnapshot?.data(), {
                openPredictions: -1,
                closedPredictions: 1,
              }),
            });
              marking.marked += 1;
            marking.closed += 1;
            dailySnapshots.predictionMarks += 1;
            usersNeedingDailyScores.add(prediction.userId);
            usersNeedingAnalytics.add(prediction.userId);
            return;
          }

          if (canonicalLatestStatus === "SETTLED") {
            tx.update(prediction.ref, {
              ...markUpdate,
              ...entryUpdate,
              predictionScore: mark.score,
              outcome: mark.outcome,
              xpEarned: mark.xpEarned,
              result: buildResult(price, mark),
            });
            tx.update(db.collection("users").doc(prediction.userId), {
              updatedAt: nowIso,
            });
            marking.marked += 1;
            dailySnapshots.predictionMarks += 1;
            usersNeedingDailyScores.add(prediction.userId);
            usersNeedingAnalytics.add(prediction.userId);
            return;
          }

          tx.update(prediction.ref, {
            ...markUpdate,
            ...entryUpdate,
          });
          tx.update(db.collection("users").doc(prediction.userId), {
            updatedAt: nowIso,
          });
          marking.marked += 1;
          dailySnapshots.predictionMarks += 1;
          usersNeedingDailyScores.add(prediction.userId);
          usersNeedingAnalytics.add(prediction.userId);
        });
      }
    }

    if (!dryRun && usersNeedingAnalytics.size > 0) {
      for (const userId of Array.from(usersNeedingAnalytics).sort()) {
        const recomputed = await recomputeUserAnalytics(db, userId, nowIso);
        if (!recomputed) {
          dailySnapshots.skippedUsers += 1;
        }
      }
    }

    if (!dryRun && usersNeedingDailyScores.size > 0) {
      const written = await writeUserDailyScoreSnapshots(
        db,
        Array.from(usersNeedingDailyScores).sort(),
        runDate,
        nowIso,
      );
      dailySnapshots.userScores = written.userScores;
      dailySnapshots.skippedUsers += written.skippedUsers;
    }

    const result: DailyEodMaintenanceResult = {
      dryRun,
      recompute,
      runDate,
      latestTradingDate,
      candidatePredictions: candidatePredictions.length,
      actionablePredictions: predictionsNeedingWork.length,
      scannedCandidatePredictions,
      hasMoreCandidatePredictions,
      priceLoad,
      marking,
      dailySnapshots,
    };
    if (!dryRun) {
      await runRef.set({
        market: DEFAULT_MARKET,
        runDate,
        status: "COMPLETED",
        latestTradingDate,
        hasMoreCandidatePredictions,
        missingPrices: marking.missingPrice,
        priceFailures: priceLoad.failed,
        marksUpdated: markPredictions,
        completedAt: new Date().toISOString(),
        error: null,
        recompute,
      }, { merge: true });
    }
    console.info("[daily-eod-maintenance] Completed run", result);
    return result;
  } catch (error) {
    if (!dryRun) {
      await runRef.set({
        market: DEFAULT_MARKET,
        runDate,
        status: "FAILED",
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }, { merge: true });
    }
    throw error;
  }
}
