// Review holds are not price corrections. Keep source amounts available for inspection.
// These IHT sales were observed in production on 2026-09-09. The August 31
// filing was checked against SEC's rendered Form 4; its price field is itself
// anomalous. The other related outliers remain pending source review.
export const INSIDER_VALUE_REVIEW_HOLDS = [
  { accessionNumber: "0001493152-26-040902", ticker: "IHT", filingDate: "2026-08-31", transactionCode: "S" },
  { accessionNumber: "0001493152-26-040662", ticker: "IHT", filingDate: "2026-08-28", transactionCode: "S" },
  { accessionNumber: "0001493152-26-040452", ticker: "IHT", filingDate: "2026-08-27", transactionCode: "S" },
  { accessionNumber: "0001493152-26-039933", ticker: "IHT", filingDate: "2026-08-24", transactionCode: "S" },
  { accessionNumber: "0001493152-26-008430", ticker: "IHT", filingDate: "2026-03-02", transactionCode: "S" },
] as const;

export type InsiderValueContext = {
  accessionNumber?: string | null;
  ticker?: string | null;
  filingDate?: string | null;
  transactionCode?: string | null;
};

export function hasInsiderValueReviewHold(input: InsiderValueContext): boolean {
  return INSIDER_VALUE_REVIEW_HOLDS.some((hold) =>
    input.accessionNumber === hold.accessionNumber ||
    (input.ticker?.trim().toUpperCase() === hold.ticker &&
      input.filingDate === hold.filingDate && input.transactionCode === hold.transactionCode),
  );
}

// Legacy share URLs contain aggregates, not accession numbers. Hold the entire
// ticker/date/direction group so a cached snapshot cannot bypass a source review.
export function isPublishableInsiderMove(input: InsiderValueContext & {
  totalValueUsd: number; totalShares: number; insiderCount: number; transactionCount: number;
}): boolean {
  return !hasInsiderValueReviewHold(input) &&
    Number.isFinite(input.totalValueUsd) && input.totalValueUsd > 0 &&
    input.totalValueUsd <= Number.MAX_SAFE_INTEGER &&
    Number.isFinite(input.totalShares) && input.totalShares > 0 &&
    Number.isSafeInteger(input.insiderCount) && input.insiderCount > 0 &&
    Number.isSafeInteger(input.transactionCount) && input.transactionCount >= input.insiderCount;
}
