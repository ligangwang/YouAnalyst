import { getAdminFirestore } from "@/lib/firebase/admin";

const OVERRIDE_SOURCE = "admin-override";
const DEFAULT_APPLY_LIMIT = 500;
const MAX_APPLY_LIMIT = 1000;
const DEFAULT_BATCH_CUSIP_LIMIT = 25;
const MAX_BATCH_CUSIP_LIMIT = 100;

export type UpsertCusipMappingOverrideInput = {
  cusip?: string;
  ticker?: string;
  symbol?: string;
  exchange?: string;
  updatedBy: string;
};

export type CusipMappingOverrideResult = {
  cusip: string;
  ticker: string;
  symbol: string;
  exchange: string;
  source: typeof OVERRIDE_SOURCE;
  affectedCurrentHoldings: number;
  updatedBy: string;
  updatedAt: string;
};

export type ApplyCusipMappingOverrideInput = {
  cusip?: string;
  updatedBy: string;
  limit?: number;
};

export type ApplyCusipMappingOverrideResult = {
  cusip: string;
  ticker: string;
  symbol: string;
  exchange: string;
  holdingsScanned: number;
  holdingsUpdated: number;
  changesScanned: number;
  changesUpdated: number;
  hasMore: boolean;
  updatedBy: string;
  updatedAt: string;
};

export type ApplyMappedCusipOverridesInput = {
  updatedBy: string;
  limitPerCusip?: number;
  maxCusips?: number;
};

export type ApplyMappedCusipOverridesResult = {
  cusipsScanned: number;
  cusipsWithMappings: number;
  holdingsUpdated: number;
  changesUpdated: number;
  hasMore: boolean;
  items: ApplyCusipMappingOverrideResult[];
  updatedBy: string;
  updatedAt: string;
};

type MappingDocument = {
  ticker?: unknown;
  symbol?: unknown;
  exchange?: unknown;
  source?: unknown;
};

function normalizeCusip(value: string | undefined): string {
  const cusip = value?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  if (cusip.length !== 9) {
    throw new Error("CUSIP must contain exactly 9 letters or digits.");
  }

  return cusip;
}

function normalizeTicker(value: string | undefined): string {
  const ticker = value?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? "";
  if (!ticker) {
    throw new Error("Ticker is required.");
  }

  return ticker;
}

function normalizeExchange(value: string | undefined): string {
  const exchange = value?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") || "US";
  if (!exchange) {
    throw new Error("Exchange is required.");
  }

  return exchange;
}

function normalizeSymbol(value: string | undefined, ticker: string, exchange: string): string {
  const symbol = value?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") ?? "";
  return symbol || `${ticker}.${exchange}`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeApplyLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_APPLY_LIMIT;
  }

  return Math.max(1, Math.min(MAX_APPLY_LIMIT, Math.trunc(value as number)));
}

function normalizeBatchCusipLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_CUSIP_LIMIT;
  }

  return Math.max(1, Math.min(MAX_BATCH_CUSIP_LIMIT, Math.trunc(value as number)));
}

export async function upsertCusipMappingOverride(input: UpsertCusipMappingOverrideInput): Promise<CusipMappingOverrideResult> {
  const cusip = normalizeCusip(input.cusip);
  const ticker = normalizeTicker(input.ticker);
  const exchange = normalizeExchange(input.exchange);
  const symbol = normalizeSymbol(input.symbol, ticker, exchange);
  const updatedAt = new Date().toISOString();
  const db = getAdminFirestore();
  const affectedSnapshot = await db
    .collection("institutional_holdings")
    .where("cusip", "==", cusip)
    .where("ticker", "==", null)
    .count()
    .get();

  const result: CusipMappingOverrideResult = {
    cusip,
    ticker,
    symbol,
    exchange,
    source: OVERRIDE_SOURCE,
    affectedCurrentHoldings: affectedSnapshot.data().count,
    updatedBy: input.updatedBy,
    updatedAt,
  };

  await db.collection("security_id_mappings").doc(cusip).set({
    cusip,
    ticker,
    symbol,
    exchange,
    isin: null,
    figi: null,
    lei: null,
    cik: null,
    source: OVERRIDE_SOURCE,
    updatedBy: input.updatedBy,
    updatedAt,
  }, { merge: true });

  await db.collection("security_id_mapping_override_runs").add(result);

  return result;
}

export async function applyCusipMappingOverride(input: ApplyCusipMappingOverrideInput): Promise<ApplyCusipMappingOverrideResult> {
  const cusip = normalizeCusip(input.cusip);
  return applyCusipMapping(cusip, input.updatedBy, normalizeApplyLimit(input.limit));
}

async function applyCusipMapping(cusip: string, updatedBy: string, limit: number): Promise<ApplyCusipMappingOverrideResult> {
  const db = getAdminFirestore();
  const mappingSnapshot = await db.collection("security_id_mappings").doc(cusip).get();
  const mapping = mappingSnapshot.data() as MappingDocument | undefined;
  const ticker = normalizeTicker(readString(mapping?.ticker) ?? undefined);
  const exchange = normalizeExchange(readString(mapping?.exchange) ?? undefined);
  const symbol = normalizeSymbol(readString(mapping?.symbol) ?? undefined, ticker, exchange);
  const mappingSource = readString(mapping?.source) ?? OVERRIDE_SOURCE;
  const updatedAt = new Date().toISOString();
  const [holdingsSnapshot, changesSnapshot] = await Promise.all([
    db.collection("institutional_holdings").where("cusip", "==", cusip).where("ticker", "==", null).limit(limit).get(),
    db.collection("institutional_holding_changes").where("cusip", "==", cusip).where("ticker", "==", null).limit(limit).get(),
  ]);
  const holdingsToUpdate = holdingsSnapshot.docs;
  const changesToUpdate = changesSnapshot.docs;
  let holdingsUpdated = 0;
  let changesUpdated = 0;

  for (let index = 0; index < holdingsToUpdate.length; index += 450) {
    const batch = db.batch();
    const chunk = holdingsToUpdate.slice(index, index + 450);
    for (const doc of chunk) {
      batch.set(doc.ref, {
        ticker,
        providerSymbol: symbol,
        exchange,
        mappingSource,
        mappingAppliedAt: updatedAt,
        mappingAppliedBy: updatedBy,
        updatedAt,
      }, { merge: true });
    }
    await batch.commit();
    holdingsUpdated += chunk.length;
  }

  for (let index = 0; index < changesToUpdate.length; index += 450) {
    const batch = db.batch();
    const chunk = changesToUpdate.slice(index, index + 450);
    for (const doc of chunk) {
      batch.set(doc.ref, {
        ticker,
        mappingSource,
        mappingAppliedAt: updatedAt,
        mappingAppliedBy: updatedBy,
        updatedAt,
      }, { merge: true });
    }
    await batch.commit();
    changesUpdated += chunk.length;
  }

  const result: ApplyCusipMappingOverrideResult = {
    cusip,
    ticker,
    symbol,
    exchange,
    holdingsScanned: holdingsSnapshot.size,
    holdingsUpdated,
    changesScanned: changesSnapshot.size,
    changesUpdated,
    hasMore: holdingsSnapshot.size >= limit || changesSnapshot.size >= limit,
    updatedBy,
    updatedAt,
  };

  await db.collection("security_id_mapping_apply_runs").add(result);

  return result;
}

export async function applyMappedCusipOverrides(input: ApplyMappedCusipOverridesInput): Promise<ApplyMappedCusipOverridesResult> {
  const limitPerCusip = normalizeApplyLimit(input.limitPerCusip);
  const maxCusips = normalizeBatchCusipLimit(input.maxCusips);
  const db = getAdminFirestore();
  const sampledSnapshot = await db.collection("institutional_holdings").where("ticker", "==", null).limit(maxCusips * 5).get();
  const sampledCusips = new Set<string>();

  for (const doc of sampledSnapshot.docs) {
    const rawCusip = readString(doc.get("cusip"));
    if (!rawCusip) {
      continue;
    }

    try {
      sampledCusips.add(normalizeCusip(rawCusip));
    } catch {
      // Ignore malformed historical rows while applying valid mapped gaps.
    }

    if (sampledCusips.size >= maxCusips) {
      break;
    }
  }

  const mappedCusips: string[] = [];
  if (sampledCusips.size === 0) {
    const result: ApplyMappedCusipOverridesResult = {
      cusipsScanned: 0,
      cusipsWithMappings: 0,
      holdingsUpdated: 0,
      changesUpdated: 0,
      hasMore: false,
      items: [],
      updatedBy: input.updatedBy,
      updatedAt: new Date().toISOString(),
    };

    await db.collection("security_id_mapping_batch_apply_runs").add(result);

    return result;
  }

  const mappingSnapshots = await db.getAll(...[...sampledCusips].map((cusip) => db.collection("security_id_mappings").doc(cusip)));

  for (const snapshot of mappingSnapshots) {
    const mapping = snapshot.data() as MappingDocument | undefined;
    if (readString(mapping?.ticker)) {
      mappedCusips.push(snapshot.id);
    }
  }

  const items: ApplyCusipMappingOverrideResult[] = [];
  for (const cusip of mappedCusips) {
    items.push(await applyCusipMapping(cusip, input.updatedBy, limitPerCusip));
  }

  const result: ApplyMappedCusipOverridesResult = {
    cusipsScanned: sampledCusips.size,
    cusipsWithMappings: mappedCusips.length,
    holdingsUpdated: items.reduce((total, item) => total + item.holdingsUpdated, 0),
    changesUpdated: items.reduce((total, item) => total + item.changesUpdated, 0),
    hasMore: sampledSnapshot.size >= maxCusips * 5 || items.some((item) => item.hasMore),
    items,
    updatedBy: input.updatedBy,
    updatedAt: new Date().toISOString(),
  };

  await db.collection("security_id_mapping_batch_apply_runs").add(result);

  return result;
}
