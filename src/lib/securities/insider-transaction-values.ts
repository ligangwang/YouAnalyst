import { hasInsiderValueReviewHold, type InsiderValueContext } from "./insider-value-quality";

const AGGREGATE_PRICE_FIELD_MIN_SHARES = 100_000;
const AGGREGATE_PRICE_FIELD_MIN_VALUE = 1_000_000;

export type NormalizedInsiderTransactionAmounts = {
  pricePerShare: number | null;
  valueUsd: number | null;
  valueQuality: "usable" | "needs_review" | "unavailable";
  valueQualityReason: string | null;
};

function isPositiveFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function looksLikeAggregatePriceField(shares: number, pricePerShare: number): boolean {
  return shares >= AGGREGATE_PRICE_FIELD_MIN_SHARES && pricePerShare >= AGGREGATE_PRICE_FIELD_MIN_VALUE;
}

export function normalizeInsiderTransactionAmounts(input: InsiderValueContext & {
  shares: number | null;
  pricePerShare: number | null;
  valueUsd?: number | null;
}): NormalizedInsiderTransactionAmounts {
  const { shares, pricePerShare } = input;
  const reportedPrice = typeof pricePerShare === "number" && Number.isFinite(pricePerShare) ? pricePerShare : null;

  if (hasInsiderValueReviewHold(input)) {
    return { pricePerShare: reportedPrice, valueUsd: null, valueQuality: "needs_review",
      valueQualityReason: "Reported price requires source review. Total withheld from rankings." };
  }

  if (!isPositiveFiniteNumber(shares)) {
    return {
      pricePerShare: reportedPrice,
      valueUsd: null,
      valueQuality: "unavailable",
      valueQualityReason: "A positive share quantity is required to calculate a total.",
    };
  }

  if (!isPositiveFiniteNumber(pricePerShare)) {
    return {
      pricePerShare: reportedPrice,
      valueUsd: null,
      valueQuality: "unavailable",
      valueQualityReason: "A positive reported price is required to calculate a total.",
    };
  }

  if (looksLikeAggregatePriceField(shares, pricePerShare)) {
    return {
      pricePerShare,
      valueUsd: null,
      valueQuality: "needs_review",
      valueQualityReason: "Price may represent an aggregate amount. Source review required; no price correction applied.",
    };
  }

  const total = shares * pricePerShare;
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
    return { pricePerShare, valueUsd: null, valueQuality: "needs_review",
      valueQualityReason: "Calculated total exceeds the supported numeric range." };
  }

  return {
    pricePerShare,
    valueUsd: Math.round(total),
    valueQuality: "usable",
    valueQualityReason: null,
  };
}
