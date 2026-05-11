import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldPath, QueryDocumentSnapshot } from "firebase-admin/firestore";

const DEFAULT_EXCHANGE = "US";
const ANY_EXCHANGE = "ANY";
const DEFAULT_CUSIP_LIMIT = 100;
const MAX_CUSIP_LIMIT = 1000;
const MAPPING_SOURCE = "openfigi";
const MAPPING_BATCH_SIZE = 450;
const OPENFIGI_BATCH_SIZE = 100;
const OPENFIGI_REQUEST_DELAY_MS = 250;
const UNMAPPED_HOLDINGS_PAGE_SIZE = 1000;
const OPENFIGI_LOG_SAMPLE_SIZE = 5;

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

type OpenFigiSecurityIdMapping = {
  cusip: string;
  symbol: string;
  ticker: string;
  exchange: string;
  isin: null;
  figi: string | null;
  lei: null;
  cik: null;
  source: typeof MAPPING_SOURCE;
  updatedAt: string;
};

export type SyncOpenFigiIdMappingsInput = {
  exchange?: string;
  maxCusips?: number;
  dryRun?: boolean;
};

export type SyncOpenFigiIdMappingsResult = {
  dryRun: boolean;
  exchange: string;
  maxCusips: number;
  fetched: number;
  mapped: number;
  written: number;
  skipped: number;
  batches: number;
  warnings: number;
  errors: number;
  source: typeof MAPPING_SOURCE;
  updatedAt: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeExchange(value: string | undefined): string | null {
  const normalized = (value?.trim() || DEFAULT_EXCHANGE).toUpperCase().replace(/[^A-Z0-9.*-]/g, "");
  return normalized === ANY_EXCHANGE || normalized === "ALL" || normalized === "*" ? null : normalized;
}

function normalizeCusip(value: unknown): string | null {
  const cusip = readString(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;
  return cusip && cusip.length === 9 ? cusip : null;
}

function normalizeSymbol(value: unknown): string | null {
  return readString(value)?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? null;
}

function compactLogMessage(value: unknown): string | null {
  const text = readString(value);
  return text ? text.slice(0, 240) : null;
}

function appendSample(samples: string[], value: string | null): void {
  if (value && samples.length < OPENFIGI_LOG_SAMPLE_SIZE && !samples.includes(value)) {
    samples.push(value);
  }
}

function normalizeCusipLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CUSIP_LIMIT;
  }

  return Math.max(1, Math.min(MAX_CUSIP_LIMIT, Math.trunc(value as number)));
}

function getOpenFigiApiKey(): string {
  const apiKey = process.env.OPENFIGI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("OPENFIGI_API_KEY is not configured.");
  }

  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listUnmappedHoldingCusips(limit: number): Promise<string[]> {
  const db = getAdminFirestore();
  const seen = new Set<string>();
  const unresolved: string[] = [];
  let lastDoc: QueryDocumentSnapshot | null = null;

  while (unresolved.length < limit) {
    let query = db
      .collection("institutional_holdings")
      .where("ticker", "==", null)
      .orderBy(FieldPath.documentId())
      .limit(UNMAPPED_HOLDINGS_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    const candidateCusips: string[] = [];

    for (const doc of snapshot.docs) {
      const cusip = normalizeCusip(doc.get("cusip"));
      if (!cusip || seen.has(cusip)) {
        continue;
      }

      seen.add(cusip);
      candidateCusips.push(cusip);
    }

    for (let index = 0; index < candidateCusips.length; index += MAPPING_BATCH_SIZE) {
      const chunk = candidateCusips.slice(index, index + MAPPING_BATCH_SIZE);
      const refs = chunk.map((cusip) => db.collection("security_id_mappings").doc(cusip));
      const snapshots = await db.getAll(...refs);

      for (const mappingSnapshot of snapshots) {
        if (readString(mappingSnapshot.get("ticker"))) {
          continue;
        }

        unresolved.push(mappingSnapshot.id);
        if (unresolved.length >= limit) {
          return unresolved;
        }
      }
    }
  }

  return unresolved;
}

function parseOpenFigiMapping(cusip: string, record: OpenFigiMappingResult, exchange: string | null, updatedAt: string): OpenFigiSecurityIdMapping | null {
  const ticker = normalizeSymbol(record.ticker);
  const mappedExchange = normalizeSymbol(record.exchCode) ?? exchange;

  if (!ticker || !mappedExchange) {
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
    source: MAPPING_SOURCE,
    updatedAt,
  };
}

async function fetchOpenFigiMappings(cusips: string[], exchange: string | null): Promise<OpenFigiMappingResponseItem[]> {
  const response = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openfigi-apikey": getOpenFigiApiKey(),
    },
    body: JSON.stringify(cusips.map((cusip) => ({
      idType: "ID_CUSIP",
      idValue: cusip,
      ...(exchange ? { exchCode: exchange } : {}),
    }))),
  });
  const payload = await response.json().catch(() => []) as unknown;

  if (!response.ok) {
    const message = Array.isArray(payload) ? response.statusText : readString((payload as { error?: unknown }).error) ?? response.statusText;
    throw new Error(`OpenFIGI mapping request failed with HTTP ${response.status}: ${message}`);
  }

  return Array.isArray(payload) ? payload as OpenFigiMappingResponseItem[] : [];
}

async function persistMappings(mappings: OpenFigiSecurityIdMapping[]): Promise<number> {
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

export async function syncOpenFigiIdMappings(input: SyncOpenFigiIdMappingsInput = {}): Promise<SyncOpenFigiIdMappingsResult> {
  const exchange = normalizeExchange(input.exchange);
  const exchangeLabel = exchange ?? ANY_EXCHANGE;
  const maxCusips = normalizeCusipLimit(input.maxCusips);
  const dryRun = input.dryRun === true;
  const updatedAt = new Date().toISOString();
  const cusips = await listUnmappedHoldingCusips(maxCusips);
  let mapped = 0;
  let written = 0;
  let skipped = 0;
  let warnings = 0;
  let errors = 0;
  let batches = 0;

  console.info("[openfigi] Starting security ID mapping sync", {
    dryRun,
    exchange: exchangeLabel,
    fetched: cusips.length,
    maxCusips,
    source: MAPPING_SOURCE,
  });

  for (let index = 0; index < cusips.length; index += OPENFIGI_BATCH_SIZE) {
    const chunk = cusips.slice(index, index + OPENFIGI_BATCH_SIZE);
    const responseItems = await fetchOpenFigiMappings(chunk, exchange);
    const mappings: OpenFigiSecurityIdMapping[] = [];
    batches += 1;
    let batchWarnings = 0;
    let batchErrors = 0;
    let batchSkipped = 0;
    const warningSamples: string[] = [];
    const errorSamples: string[] = [];
    const skippedSamples: string[] = [];

    for (let itemIndex = 0; itemIndex < chunk.length; itemIndex += 1) {
      const item = responseItems[itemIndex];
      const data = Array.isArray(item?.data) ? item.data as OpenFigiMappingResult[] : [];
      const firstResult = (exchange ? data.find((record) => normalizeSymbol(record.exchCode) === exchange && normalizeSymbol(record.ticker)) : null)
        ?? data.find((record) => normalizeSymbol(record.ticker));
      const mapping = firstResult ? parseOpenFigiMapping(chunk[itemIndex], firstResult, exchange, updatedAt) : null;

      if (item?.warning) {
        warnings += 1;
        batchWarnings += 1;
        appendSample(warningSamples, `${chunk[itemIndex]}: ${compactLogMessage(item.warning)}`);
      }
      if (item?.error) {
        errors += 1;
        batchErrors += 1;
        appendSample(errorSamples, `${chunk[itemIndex]}: ${compactLogMessage(item.error)}`);
      }
      if (!mapping) {
        skipped += 1;
        batchSkipped += 1;
        appendSample(
          skippedSamples,
          `${chunk[itemIndex]}: data=${data.length}${item?.warning ? " warning" : ""}${item?.error ? " error" : ""}`,
        );
        continue;
      }

      mappings.push(mapping);
    }

    mapped += mappings.length;
    if (!dryRun && mappings.length > 0) {
      written += await persistMappings(mappings);
    }
    console.info("[openfigi] Processed security ID mapping batch", {
      batch: batches,
      batchSize: chunk.length,
      dryRun,
      errors: batchErrors,
      exchange: exchangeLabel,
      mapped: mappings.length,
      skipped: batchSkipped,
      warningSamples,
      warnings: batchWarnings,
      errorSamples,
      skippedSamples,
      written: dryRun ? 0 : mappings.length,
    });
    if (index + OPENFIGI_BATCH_SIZE < cusips.length) {
      await sleep(OPENFIGI_REQUEST_DELAY_MS);
    }
  }

  if (!dryRun) {
    await getAdminFirestore().collection("security_id_mapping_sync_runs").add({
      exchange: exchangeLabel,
      source: MAPPING_SOURCE,
      pageLimit: OPENFIGI_BATCH_SIZE,
      startOffset: 0,
      nextOffset: null,
      total: cusips.length,
      fetched: cusips.length,
      mapped,
      written,
      skipped,
      pages: batches,
      hasMore: false,
      warnings,
      errors,
      updatedAt,
    });
  }

  console.info("[openfigi] Completed security ID mapping sync", {
    batches,
    dryRun,
    errors,
    exchange: exchangeLabel,
    fetched: cusips.length,
    mapped,
    skipped,
    source: MAPPING_SOURCE,
    updatedAt,
    warnings,
    written: dryRun ? 0 : written,
  });

  return {
    dryRun,
    exchange: exchangeLabel,
    maxCusips,
    fetched: cusips.length,
    mapped,
    written: dryRun ? 0 : written,
    skipped,
    batches,
    warnings,
    errors,
    source: MAPPING_SOURCE,
    updatedAt,
  };
}
