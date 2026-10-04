import { createHash } from "node:crypto";

export const EARNINGS_SCHEMA_VERSION = 1 as const;
export const EARNINGS_PARSER_VERSION = "map-1";
export type EarningsKind = "actual" | "preliminary" | "forecast";
export type Period = { start: string; end: string; type: "quarter" | "half_year" | "nine_month_ytd" | "annual"; fiscalYear: number; fiscalQuarter?: number };
export type ForecastPeriod = { start: null; end: null; type: "quarter"; fiscalYear: number; fiscalQuarter: number };
export type MetricPeriod = Period | ForecastPeriod;
export type SourceTime = { value: string; precision: "date" | "second"; timezone: string | null };
export type EarningsSource = {
  provider: "sec" | "cninfo" | "issuer_ir";
  companyId: string; issuerId: string; documentId: string; url: string; title: string;
  publishedAt: SourceTime | null; firstSeenAt: string;
  filingAcceptedAt?: string | null; filingDate?: string; accession?: string; form?: string;
  language: "en" | "zh"; correctionOf?: string;
  // Added only when an existing issuer/document source belongs to another map
  // listing. Original source IDs stay stable; aliases get an independent intake.
  listingId?: string;
};
export type Evidence = { start: number; end: number; text: string; page: number | null; sourceUrl?: string };
export type RawEarningsDocument = {
  source: EarningsSource; sourceId: string; rawSha256: string; textSha256: string;
  mediaType: "text/html" | "text/plain" | "application/pdf";
  text: string; retrievedAt: string; textMethod: "html" | "plain" | "pdftotext-layout";
  // An excerpt tests extraction; it never counts as a complete raw capture.
  completeness: "full" | "excerpt";
};
export type EarningsMetric = {
  name: "revenue" | "revenue_yoy" | "revenue_qoq"; label: string;
  value: number | null; low?: number; high?: number; point?: number; approximate?: boolean; currency: string | null;
  unit: "currency" | "percent"; scale: number;
  kind: EarningsKind; basis: "US_GAAP" | "IFRS" | "PRC_GAAP" | "non_GAAP" | "unspecified";
  scope: "consolidated" | "segment" | "market_platform" | "segment_business" | "cross_segment_metric"; segment?: string;
  period: MetricPeriod; comparisonPeriod?: Period; evidence: Evidence[];
  derivation: "reported" | "midpoint_plus_minus";
  sourceUrl: string; sourceEvidenceKind: "raw_document" | "curated_factual_excerpt";
};
export type EarningsRecord = {
  version: typeof EARNINGS_SCHEMA_VERSION; type: "earnings.extracted";
  eventId: string; revisionId: string; groupId: string; sourceId: string;
  companyId: string; issuerId: string; kind: EarningsKind; period: Period; periodEvidence: Evidence[]; periodStartDerivation: string;
  announcementDate: string | null; announcementDateEvidence: Evidence | null;
  source: EarningsSource; rawSha256: string; textSha256: string;
  parserVersion: string; extractedAt: string; completeness: "full" | "excerpt";
  metrics: EarningsMetric[]; warnings: string[];
  coverage: { revenue: "extracted" | "unavailable"; segments: "extracted" | "not_extracted"; guidance: "extracted" | "not_extracted" };
  supersedes?: string;
};
export type ExtractionOutcome = { status: "extracted"; record: EarningsRecord } | { status: "skipped" | "review_required"; reason: string; sourceId: string };
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const stableId = (prefix: string, parts: unknown[]) => `${prefix}_${sha256(canonicalJson(parts))}`;
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && validDate(value.slice(0, 10));
}
export function validatePeriod(period: Period) {
  if (!validDate(period.start) || !validDate(period.end) || period.start > period.end || !Number.isInteger(period.fiscalYear)
    || period.fiscalYear < 1900 || period.fiscalYear > 2200) throw new Error("Invalid fiscal period");
  const days = (Date.parse(period.end) - Date.parse(period.start)) / 86_400_000 + 1;
  const ranges = { quarter: [70, 110], half_year: [160, 200], nine_month_ytd: [250, 290], annual: [340, 385] };
  const range = ranges[period.type];
  if (!range || days < range[0] || days > range[1]) throw new Error("Fiscal duration does not match period type");
  if (period.type === "quarter" && (!Number.isInteger(period.fiscalQuarter) || period.fiscalQuarter! < 1 || period.fiscalQuarter! > 4)) throw new Error("Quarter needs fiscal quarter");
  if (period.type !== "quarter" && period.fiscalQuarter !== undefined) throw new Error("YTD or annual period cannot be labelled quarter");
}
export function sourceIdentity(source: EarningsSource) {
  return stableId("earnings_source", [source.provider, source.issuerId, source.documentId, ...(source.listingId ? [source.listingId] : [])]);
}

export function validateMetricPeriod(period: MetricPeriod, kind: EarningsKind) {
  if (period.start === null || period.end === null) {
    if (kind !== "forecast" || period.start !== null || period.end !== null || period.type !== "quarter" || !Number.isInteger(period.fiscalYear) || !Number.isInteger(period.fiscalQuarter) || period.fiscalQuarter! < 1 || period.fiscalQuarter! > 4) throw new Error("Only labelled future guidance can omit exact dates");
    return;
  }
  validatePeriod(period as Period);
}
