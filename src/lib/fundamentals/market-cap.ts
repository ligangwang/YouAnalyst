import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type { CompanyFacts } from "./model";
import { FUNDAMENTALS_COLLECTION, validFundamentalsTicker } from "./service";
import { maintenanceError, type MaintenanceLog } from "../maintenance-log";
import { readLatestUsPrices } from "../predictions/latest-eod";
import { verifiedForeignListings, foreignOutstandingTags, reviewedForeignShareCounts, type VerifiedForeignListing } from "./foreign-listings";

export type ShareBasis = { shares: number; date: string; filed: string; sourceUrl: string; tag: string; listing?: VerifiedForeignListing };
export type ShareAssessment = { basis: ShareBasis | null; reason: string | null; version?: number };
export type MarketCap = { status: "estimated" | "unavailable"; value: number | null; currency: "USD";
  priceDate: string | null; close: number | null; shares: ShareBasis | null; reason: string | null; calculatedAt: string };
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;

export function assessShares(facts: CompanyFacts, ticker: string, tickers: unknown, form: string, today = new Date().toISOString().slice(0,10)): ShareAssessment {
  const unavailable = (reason: string): ShareAssessment => ({basis:null,reason,version:3});
  // Companyfacts aggregates entity-wide data, not ADR ratios or share-class prices.
  const foreign = form !== "10-K";
  const listing = foreign ? verifiedForeignListings[ticker] : undefined;
  if (foreign && (!listing || listing.cik !== Number(facts.cik) || form !== "20-F")) return unavailable("foreign_listing_requires_verified_share_ratio");
  if (!Array.isArray(tickers) || (!foreign && tickers.length !== 1) || !tickers.some(t => String(t).replaceAll("-", ".") === ticker.replaceAll("-", "."))) return unavailable("ambiguous_listing_or_share_classes");
  const tags = foreign ? foreignOutstandingTags[ticker] ?? [] : ["dei:EntityCommonStockSharesOutstanding"];
  const rows = tags.flatMap(tag => {
    const [namespace, name] = tag.split(":");
    return (facts.facts?.[namespace]?.[name]?.units?.shares ?? []).map(row => ({...row,tag}));
  });
  const candidates = rows.filter(r => !r.start && date(r.end) && date(r.filed) && r.end <= today && r.filed <= today
    && (foreign ? ["20-F","20-F/A","6-K","6-K/A"] : ["10-K","10-K/A","10-Q","10-Q/A"]).includes(r.form ?? "") && /^\d{10}-\d{2}-\d{6}$/.test(r.accn ?? "")
    && typeof r.val === "number" && Number.isSafeInteger(r.val) && r.val > 0)
    .sort((a,b)=>b.end!.localeCompare(a.end!) || b.filed!.localeCompare(a.filed!));
  const reviewed = foreign ? reviewedForeignShareCounts[ticker] : undefined;
  if (reviewed && reviewed.date <= today && reviewed.filed <= today
    && (!candidates.length || reviewed.date > candidates[0].end!)) {
    const laterSplit = Object.entries(facts.facts?.["us-gaap"] ?? {}).filter(([name])=>/StockSplit|StockSplits/.test(name))
      .some(([,concept])=>Object.values(concept.units ?? {}).flat().some(r=>date(r.end) && r.end > reviewed.date && r.end <= today));
    if (laterSplit) return unavailable("split_requires_updated_share_count");
    return {basis:{...reviewed,listing},reason:null,version:3};
  }
  if (!candidates.length) return unavailable("missing_outstanding_shares");
  const latest = candidates[0];
  if (new Set(candidates.filter(r=>r.end === latest.end && r.filed === latest.filed).map(r=>r.val)).size !== 1) return unavailable("ambiguous_outstanding_shares");
  // Do not apply split ratios without verified effective dates. A newer report
  // mentioning a split requires a fresh post-split share count first.
  const split = Object.entries(facts.facts?.["us-gaap"] ?? {}).filter(([name])=>/StockSplit|StockSplits/.test(name))
    .some(([,concept])=>Object.values(concept.units ?? {}).flat().some(r=>date(r.end) && r.end > latest.end! && r.end <= today));
  if (split) return unavailable("split_requires_updated_share_count");
  return {basis:{shares:latest.val as number,date:latest.end!,filed:latest.filed!,tag:latest.tag,
    ...(listing ? {listing} : {}),
    sourceUrl:`https://www.sec.gov/Archives/edgar/data/${Number(facts.cik)}/${latest.accn!.replaceAll("-", "")}/${latest.accn}-index.html`},reason:null,version:3};
}

export function calculateMarketCap(assessment: ShareAssessment | undefined, price: Record<string, unknown> | undefined, ticker: string, now = new Date()): MarketCap {
  const result: MarketCap = {status:"unavailable",value:null,currency:"USD",priceDate:null,close:null,shares:assessment?.basis ?? null,
    reason:assessment?.reason ?? "shares_not_yet_refreshed",calculatedAt:now.toISOString()};
  if (!price || price.ticker !== ticker || price.market !== "US" || !date(price.tradingDate) || price.tradingDate > now.toISOString().slice(0,10)
    || typeof price.close !== "number" || !Number.isFinite(price.close) || price.close <= 0) return {...result,reason:"missing_or_invalid_cached_price"};
  result.priceDate = price.tradingDate; result.close = price.close;
  const basis = assessment?.basis;
  if (!basis) return result;
  if (basis.date > price.tradingDate) return {...result,reason:"share_count_newer_than_price"};
  // Annual disclosures remain eligible through 365 days after observation.
  if (now.getTime()-Date.parse(basis.date) > 365*86_400_000) return {...result,reason:"stale_share_count"};
  const ratio = basis.listing?.ordinarySharesPerUnit ?? 1;
  if (basis.listing) {
    const verified = verifiedForeignListings[ticker];
    if (!verified || verified.cik !== basis.listing.cik || verified.ordinarySharesPerUnit !== ratio
      || verified.sourceUrl !== basis.listing.sourceUrl) return {...result,reason:"foreign_listing_requires_verified_share_ratio"};
  }
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isSafeInteger(basis.shares) || basis.shares <= 0) return {...result,reason:"invalid_calculation"};
  const value = price.close * (basis.shares / ratio);
  if (!Number.isFinite(value) || value <= 0) return {...result,reason:"invalid_calculation"};
  return {...result,status:"estimated",value,reason:null};
}

// Recalculate all cached/requested companies without making any provider calls.
export async function refreshCachedMarketCaps(db: Firestore, log: MaintenanceLog, deadline: number) {
  const result = {processed:0,estimated:0,unavailable:0,failed:0,incomplete:false};
  let cursor: string | undefined;
  while (Date.now() < deadline) {
    let query = db.collection(FUNDAMENTALS_COLLECTION).orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    const latestPrices = await readLatestUsPrices(db, page.docs.map(d => d.id).filter(validFundamentalsTicker));
    for (const doc of page.docs) {
      if (Date.now() >= deadline) return {...result,incomplete:true};
      cursor = doc.id;
      if (!validFundamentalsTicker(doc.id)) continue;
      try {
        const marketCap = calculateMarketCap(doc.data().value?.shareAssessment,latestPrices.get(doc.id),doc.id);
        await doc.ref.set({marketCap},{merge:true});
        result.processed++; result[marketCap.status]++;
        log.emit("INFO","market_cap_calculated",{ticker:doc.id,...marketCap});
      } catch(error) {result.failed++;log.emit("ERROR","market_cap_failed",{ticker:doc.id,error:maintenanceError(error)});}
    }
    if (page.size < 100) return result;
  }
  return {...result,incomplete:true};
}
