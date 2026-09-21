import { getAdminFirestore } from "../firebase/admin";
import { maintenanceError } from "../maintenance-log";
import type { CompanyFundamentals } from "./model";

export const FUNDAMENTALS_COLLECTION = "company_fundamentals";
export const validFundamentalsTicker = (ticker: string) => /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker);
type Database = ReturnType<typeof getAdminFirestore>;

// The existing cache document doubles as a durable, deduplicated request record.
// Page reads never import the SEC worker or make provider requests.
export async function requestCompanyFundamentals(ticker: string, db: Database, now = Date.now()) {
  if (!validFundamentalsTicker(ticker)) return null;
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc(ticker);
  return db.runTransaction(async tx => {
    const stored = (await tx.get(ref)).data();
    const value = stored?.version === 1 ? (stored.value as CompanyFundamentals | null) ?? null : null;
    const due = (!stored?.requestedAt && !value) || Number(stored?.refreshAfter ?? 0) <= now;
    if (due && stored?.pending !== true) {
      tx.set(ref, { version: 1, pending: true, requestedAt: new Date(now).toISOString() }, { merge: true });
    }
    return value ? { ...value, stale: now - Date.parse(value.fetchedAt) > 2 * 86_400_000 } : null;
  });
}

export async function loadCompanyFundamentals(ticker: string): Promise<CompanyFundamentals | null> {
  try {
    return await requestCompanyFundamentals(ticker, getAdminFirestore());
  } catch (error) {
    console.error(JSON.stringify({ severity: "ERROR", message: "fundamentals: cache_request_failed", ticker, error: maintenanceError(error) }));
    return null;
  }
}
