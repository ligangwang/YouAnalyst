import { getAdminFirestore } from "@/lib/firebase/admin";

const OVERRIDE_SOURCE = "admin-override";

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
