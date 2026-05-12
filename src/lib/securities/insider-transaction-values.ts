const AGGREGATE_PRICE_FIELD_MIN_SHARES = 100_000;
const AGGREGATE_PRICE_FIELD_MIN_VALUE = 1_000_000;

export type NormalizedInsiderTransactionAmounts = {
  pricePerShare: number | null;
  valueUsd: number | null;
};

function isPositiveFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function looksLikeAggregatePriceField(shares: number, pricePerShare: number): boolean {
  return shares >= AGGREGATE_PRICE_FIELD_MIN_SHARES && pricePerShare >= AGGREGATE_PRICE_FIELD_MIN_VALUE;
}

export function normalizeInsiderTransactionAmounts(input: {
  shares: number | null;
  pricePerShare: number | null;
  valueUsd?: number | null;
}): NormalizedInsiderTransactionAmounts {
  const { shares, pricePerShare } = input;
  const storedValueUsd = input.valueUsd ?? null;

  if (!isPositiveFiniteNumber(shares)) {
    return {
      pricePerShare,
      valueUsd: isPositiveFiniteNumber(storedValueUsd) ? storedValueUsd : null,
    };
  }

  if (!isPositiveFiniteNumber(pricePerShare)) {
    return {
      pricePerShare: null,
      valueUsd: isPositiveFiniteNumber(storedValueUsd) ? storedValueUsd : null,
    };
  }

  if (looksLikeAggregatePriceField(shares, pricePerShare)) {
    return {
      pricePerShare: pricePerShare / shares,
      valueUsd: Math.round(pricePerShare),
    };
  }

  return {
    pricePerShare,
    valueUsd: Math.round(shares * pricePerShare),
  };
}
