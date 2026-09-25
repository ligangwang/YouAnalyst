import { privateValuationFresh, privateValuationSources } from "../fundamentals/private-valuations";
import type { GraphPrivateValuation } from "./model";

// Project an explicit public summary; never expose provider errors or arbitrary
// stored source URLs. Only reviewed, current financing records may be displayed.
export function projectPrivateValuation(id: string, listingStatus: unknown, stored: unknown, now = Date.now()): GraphPrivateValuation | undefined {
  if (listingStatus !== "PRIVATE" || !stored || typeof stored !== "object") return;
  const check = stored as Record<string, unknown>;
  const approved = privateValuationSources[id]?.valuation;
  if (!approved || !privateValuationFresh(approved, now) || !["verified", "review_required"].includes(String(check.status))) return;
  if (!check.valuation || typeof check.valuation !== "object") return;
  const valuation = check.valuation as Record<string, unknown>;
  if (Object.entries(approved).some(([key, value]) => valuation[key] !== value)) return;
  const checkedAt = typeof check.checkedAt === "string" ? check.checkedAt : "";
  if (!Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) > now) return;
  // Legacy successful checks predate the explicit verification field.
  const verification = check.verification ?? (check.status === "verified" ? "source_checked" : undefined);
  if (verification !== "source_checked" && verification !== "reviewed") return;
  if (verification === "reviewed" && id !== "ORG:OPENAI") return;
  return { ...approved, verification, reviewPending: check.status === "review_required" };
}
