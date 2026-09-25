import { getAdminFirestore } from "../firebase/admin";
import { maintenanceError } from "../maintenance-log";
import { FUNDAMENTALS_COLLECTION } from "./service";
import { CN_COMPANY_ID } from "../knowledge-graph/cn-companies";
import { isoDate, type CnMarketCap } from "./cn-market-cap";

// What an A-share company page shows. Page reads never contact providers.
export type PublicCnMarketCap = {
  status: "estimated" | "unavailable"; reason: string | null; value: number | null; currency: "CNY";
  usd: { value: number; rate: number; rateDate: string } | null;
  priceDate: string | null; close: number | null; lastClose: boolean;
  shares: { total: number; a: number; h: number | null; b: number; date: string; asOf: string; sourceUrl: string } | null;
};
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const httpsUrl = (v: unknown): v is string => typeof v === "string" && /^https:\/\/[\w.-]+\.(?:com\.cn|cn)\//.test(v);

export function publicCnMarketCap(value: unknown): PublicCnMarketCap | null {
  const cap = value as Partial<CnMarketCap> | undefined;
  if (!cap || cap.currency !== "CNY" || (cap.status !== "estimated" && cap.status !== "unavailable")) return null;
  const s = cap.shares;
  const shares = s && positive(s.totalShares) && positive(s.aShares) && isoDate(s.date) && isoDate(s.asOf) && httpsUrl(s.sourceUrl)
    ? { total: s.totalShares, a: s.aShares, h: positive(s.hShares) ? s.hShares : null, b: positive(s.bShares) ? s.bShares : 0, date: s.date, asOf: s.asOf, sourceUrl: s.sourceUrl } : null;
  const estimated = cap.status === "estimated" && positive(cap.value) && isoDate(cap.priceDate) && positive(cap.close) && shares !== null;
  const usd = estimated && cap.usd && positive(cap.usd.value) && positive(cap.usd.rate) && isoDate(cap.usd.rateDate)
    ? { value: cap.usd.value, rate: cap.usd.rate, rateDate: cap.usd.rateDate } : null;
  return { status: estimated ? "estimated" : "unavailable", reason: estimated ? null : typeof cap.reason === "string" ? cap.reason : "unavailable",
    value: estimated ? cap.value! : null, currency: "CNY", usd, priceDate: isoDate(cap.priceDate) ? cap.priceDate : null,
    close: positive(cap.close) ? cap.close : null, lastClose: cap.lastClose === true, shares };
}

export async function loadCnMarketCap(id: string): Promise<PublicCnMarketCap | null> {
  if (!CN_COMPANY_ID.test(id)) return null;
  try {
    const doc = await getAdminFirestore().collection(FUNDAMENTALS_COLLECTION).doc(id).get();
    return publicCnMarketCap(doc.get("marketCap"));
  } catch (error) {
    console.error(JSON.stringify({ severity: "ERROR", message: "fundamentals: cn_market_cap_read_failed", company: id, error: maintenanceError(error) }));
    return null;
  }
}
