import { getAdminFirestore } from "../firebase/admin";
import { maintenanceError } from "../maintenance-log";
import type { CompanyFundamentals } from "./model";
import type { DocumentData } from "firebase-admin/firestore";

export const FUNDAMENTALS_COLLECTION = "company_fundamentals";
export const validFundamentalsTicker = (ticker: string) => /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker);
type Database = ReturnType<typeof getAdminFirestore>;
export const needsShareMetadataUpgrade = (stored?: DocumentData) => Boolean(stored?.value
  && (!stored.value.shareAssessment || (stored.value.report?.form === "20-F" && stored.value.shareAssessment.version !== 2))
  && (!stored.outcome || stored.outcome === "ready"));

// The existing cache document doubles as a durable, deduplicated request record.
// Page reads never import the SEC worker or make provider requests.
export async function requestCompanyFundamentals(ticker: string, db: Database, now = Date.now()) {
  if (!validFundamentalsTicker(ticker)) return null;
  const ref = db.collection(FUNDAMENTALS_COLLECTION).doc(ticker);
  const valueOf = (stored?: DocumentData): CompanyFundamentals | null => stored?.version === 1 && stored.value
    ? { ...stored.value, ...(stored.marketCap ? { marketCap: stored.marketCap } : {}) } : null;
  const needsRequest = (stored?: DocumentData) => stored?.pending !== true
    && ((!stored?.requestedAt && !valueOf(stored)) || Number(stored?.refreshAfter ?? 0) <= now
      || needsShareMetadataUpgrade(stored));
  const fresh = (value: CompanyFundamentals | null) => value ? { ...value, stale: now - Date.parse(value.fetchedAt) > 2 * 86_400_000 } : null;
  const current = (await ref.get()).data();
  // Busy pages must not lock the cache document on every visitor read.
  if (!needsRequest(current)) return fresh(valueOf(current));
  return db.runTransaction(async tx => {
    const stored = (await tx.get(ref)).data();
    if (needsRequest(stored)) {
      tx.set(ref, { version: 1, pending: true, requestedAt: new Date(now).toISOString() }, { merge: true });
    }
    return fresh(valueOf(stored));
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
