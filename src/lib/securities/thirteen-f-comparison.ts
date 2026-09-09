import type { InstitutionalHolding } from "./thirteen-f";

export function completeHoldingsBaseline(
  canonical: Record<string, unknown> | undefined,
  rows: InstitutionalHolding[],
  managerCik: string,
  quarter: string,
): boolean {
  if (!canonical || canonical.holdingsComplete !== true || canonical.managerCik !== managerCik || canonical.quarter !== quarter) return false;
  // An additions-only amendment is not a complete replacement portfolio.
  if (canonical.form !== "13F-HR" && !(canonical.form === "13F-HR/A" && canonical.amendmentType === "RESTATEMENT")) return false;
  if (typeof canonical.accessionNumber !== "string" || !canonical.accessionNumber ||
      typeof canonical.holdingCount !== "number" || !Number.isSafeInteger(canonical.holdingCount) || canonical.holdingCount < 0) return false;
  return rows.length === canonical.holdingCount && new Set(rows.map(row => row.positionKey)).size === rows.length &&
    rows.every(row => Boolean(row.positionKey) && row.accessionNumber === canonical.accessionNumber &&
      row.managerCik === managerCik && row.quarter === quarter &&
      Number.isFinite(row.shares) && row.shares >= 0 && Number.isFinite(row.valueUsd) && row.valueUsd >= 0);
}

// Legacy comparisons were calculated without a completeness check. Fail closed
// until the report is reprocessed with a verified baseline.
export function hasVerifiedHoldingComparison(change: { baselineVerified?: unknown }): boolean {
  return change.baselineVerified === true;
}
