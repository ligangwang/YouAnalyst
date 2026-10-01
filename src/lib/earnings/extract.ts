import { EARNINGS_PARSER_VERSION, type EarningsKind, type EarningsMetric, type EarningsRecord, type Evidence, type ExtractionOutcome, type Period, type MetricPeriod, type RawEarningsDocument, sha256, stableId, canonicalJson, validatePeriod, validateMetricPeriod, validDate, validTimestamp } from "./model";
import { datesInEvidence, assertEnglishFiscalLabel, assertChineseReportPeriod, assertGuidancePeriod } from "./dates";
import { classifyEarningsTitle } from "./discovery";
import { pilotCompany, validateSourceUrl } from "./pilot";

export type MetricRule = {
  name: EarningsMetric["name"]; pointIndex?: number; label: string; rowLabel: string;
  // Rules are reviewed local adapter configuration, never supplied by a website.
  // A row must be unique within the bounded section and contain the required header.
  sectionStart?: string; sectionEnd?: string; header?: string; valueIndex?: number;
  unitEvidence?: string; sourceUrl?: string; derivation?: "reported" | "midpoint_plus_minus"; range?: boolean; rangeMode?: "endpoints" | "plus_minus_absolute" | "plus_minus_percent"; toleranceScale?: number; toleranceUnitEvidence?: string; approximate?: boolean; currency: string | null; scale: number; unit: "currency" | "percent";
  kind: EarningsKind; basis: EarningsMetric["basis"]; scope: EarningsMetric["scope"]; segment?: string;
  period?: MetricPeriod; periodEvidence?: string[];
};
export type ExtractionPlan = {
  period: Period; periodStartDerivation?: string; periodEvidence: string[]; kind?: EarningsKind;
  announcementDate?: string; announcementDateEvidence?: string;
  metrics: MetricRule[];
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Only whitespace is flexible; punctuation, signs, numbers and words must match.
function locate(text: string, needle: string, from = 0, to = text.length): Evidence[] {
  if (!needle.trim() || needle.length > 2000) throw new Error("Invalid evidence locator");
  const expression = needle.trim().split(/\s+/).map(escape).join("\\s+");
  const matches = [...text.slice(from, to).matchAll(new RegExp(expression, "gi"))];
  return matches.map(match => {
    const start = from + match.index!, end = start + match[0].length;
    return { start, end, text: text.slice(start, end), page: text.includes("\f") ? text.slice(0, start).split("\f").length : null };
  });
}
function evidence(text: string, needle: string) {
  const matches = locate(text, needle);
  if (!matches.length) throw new Error(`Evidence not found: ${needle.slice(0, 80)}`);
  return matches[0];
}
function numericCells(text: string) {
  return [...text.matchAll(/(?<![\p{L}\p{N}])\(?[-−+]?\d[\d,]*(?:\.\d+)?\)?(?:\s*%)?/gu)].map(match => {
    const raw = match[0].replace(/\s+/g, "");
    const value = Number(raw.replace(/[,()%+]/g, "").replace("−", "-")) * (raw.startsWith("(") ? -1 : 1);
    const direction = /(?:down|decreas(?:ed|e)(?: by)?|下降|减少)\s*$/i.test(text.slice(Math.max(0, match.index! - 25), match.index));
    return { value: direction ? -Math.abs(value) : value, raw };
  });
}
function extractMetric(document: RawEarningsDocument, rule: MetricRule, defaultPeriod: Period): EarningsMetric {
  const { text } = document;
  if (!["revenue", "revenue_yoy", "revenue_qoq"].includes(rule.name)
    || !["actual", "preliminary", "forecast"].includes(rule.kind)
    || !["US_GAAP", "IFRS", "PRC_GAAP", "non_GAAP", "unspecified"].includes(rule.basis)
    || !["consolidated", "segment", "market_platform", "segment_business", "cross_segment_metric"].includes(rule.scope)
    || !["currency", "percent"].includes(rule.unit)) throw new Error("Invalid metric classification");
  const period = rule.period ?? defaultPeriod;
  validateMetricPeriod(period, rule.kind);
  if (!Number.isFinite(rule.scale) || rule.scale <= 0 || ![1, 1e3, 1e4, 1e6, 1e8, 1e9].includes(rule.scale)) throw new Error("Invalid metric scale");
  if (rule.unit === "currency" ? !/^[A-Z]{3}$/.test(rule.currency ?? "") : rule.currency !== null || rule.scale !== 1) throw new Error("Invalid metric unit");
  if (rule.scope !== "consolidated" && !rule.segment) throw new Error("Missing segment name");
  if (rule.period && !rule.periodEvidence?.length) throw new Error("Separate guidance period needs evidence");
  const periodEvidence = (rule.periodEvidence ?? []).map(needle => evidence(text, needle));
  if (rule.kind === "forecast" && rule.period) assertGuidancePeriod(rule.period, periodEvidence.map(item => item.text).join(" "));
  const unitEvidence = rule.unitEvidence ? evidence(text, rule.unitEvidence) : null;
  if (rule.unit === "currency" && !unitEvidence) throw new Error("Currency and scale need source evidence");
  if (unitEvidence) {
    const unit = unitEvidence.text.toLowerCase();
    const scale = /billion|十亿/.test(unit) ? 1e9 : /亿元/.test(unit) ? 1e8 : /million|百万/.test(unit) ? 1e6 : /万元/.test(unit) ? 1e4 : /thousand|千元/.test(unit) ? 1e3 : 1;
    if (scale !== rule.scale) throw new Error("Metric scale conflicts with source unit");
    const currency = /rmb|cny|人民币/.test(unit) ? "CNY" : /usd|us\$|u\.s\. dollars/.test(unit) ? "USD" : null;
    if (currency && currency !== rule.currency) throw new Error("Metric currency conflicts with source unit");
    if (!currency && rule.currency === "CNY" && !/元/.test(unit)) throw new Error("Currency evidence ambiguous");
  }
  let from = 0, to = text.length;
  if (rule.sectionStart) from = evidence(text, rule.sectionStart).start;
  if (rule.sectionEnd) {
    const end = locate(text, rule.sectionEnd, from + (rule.sectionStart?.length ?? 0))[0];
    if (!end) throw new Error("Metric section end missing");
    to = end.start;
  }
  const found = locate(text, rule.rowLabel, from, to);
  if (found.length !== 1) throw new Error(`Metric row is missing or ambiguous: ${rule.rowLabel}`);
  const match = found[0];
  // Each row can continue through at most two wrapped lines. It cannot absorb an
  // entire table/document and accidentally pick an unrelated later value.
  const rowEnd = Math.min(to, text.indexOf("\n", match.end) < 0 ? text.length : text.indexOf("\n", match.end));
  const tail = text.slice(match.end, rowEnd);
  const cells = numericCells(tail), index = rule.valueIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= cells.length) throw new Error(`Metric value unavailable: ${rule.rowLabel}`);
  const context = rule.header ? locate(text, rule.header, Math.max(from, match.start - 2500), match.start)[0] : null;
  if (rule.header && !context) throw new Error("Metric table header missing or too distant");
  if (rule.unit === "percent" && !cells[index].raw.endsWith("%") && !rule.header?.includes("%")) throw new Error("Percentage unit not evidenced");
  if (rule.unit === "currency" && cells[index].raw.endsWith("%")) throw new Error("Percent cannot be currency");
  const value = cells[index].value * rule.scale;
  if (!Number.isFinite(value)) throw new Error("Invalid metric value");
  const rowEvidence = { start: match.start, end: rowEnd, text: text.slice(match.start, rowEnd), page: match.page };
  const sourceUrl = rule.sourceUrl ?? document.source.url;
  if (sourceUrl !== document.source.url) {
    if (document.completeness !== "excerpt") throw new Error("Full raw document cannot evidence another source");
    validateSourceUrl(document.source.companyId, sourceUrl, new URL(sourceUrl).hostname === "www.sec.gov" ? "sec" : "issuer_ir");
  }
  const metric: EarningsMetric = { name: rule.name, label: rule.label, value, unit: rule.unit, currency: rule.currency,
    scale: rule.scale, kind: rule.kind, basis: rule.basis, scope: rule.scope, ...(rule.segment ? { segment: rule.segment } : {}),
    period, sourceUrl, sourceEvidenceKind: document.completeness === "full" ? "raw_document" : "curated_factual_excerpt", derivation: rule.derivation ?? "reported", evidence: [...(context ? [context] : []), rowEvidence, ...(unitEvidence ? [unitEvidence] : []), ...periodEvidence] };
  if (rule.range) {
    if (rule.kind !== "forecast" || !cells[index + 1] || ((!rule.rangeMode || rule.rangeMode === "endpoints") && cells[index + 1].value < cells[index].value)) throw new Error("Invalid forecast range");
    metric.value = null;
    if (!rule.rangeMode || rule.rangeMode === "endpoints") {
      if (/plus or minus|±|\+\/-/i.test(tail)) throw new Error("Midpoint guidance requires an explicit tolerance transform");
      metric.low = value; metric.high = cells[index + 1].value * rule.scale;
    } else {
      if (!/plus or minus|±|\+\/-/i.test(tail)) throw new Error("Plus/minus guidance operator not evidenced");
      const tolerance = cells[index + 1].value;
      if (tolerance < 0) throw new Error("Negative guidance tolerance");
      let delta: number;
      if (rule.rangeMode === "plus_minus_percent") {
        if (!cells[index + 1].raw.endsWith("%") || tolerance > 100) throw new Error("Invalid guidance percentage tolerance");
        delta = value * tolerance / 100;
      } else {
        if (!rule.toleranceScale || !rule.toleranceUnitEvidence) throw new Error("Mixed-unit tolerance needs evidence and scale");
        const unit = evidence(text, rule.toleranceUnitEvidence); metric.evidence.push({ ...unit, sourceUrl });
        const observed = /billion/i.test(unit.text) ? 1e9 : /million/i.test(unit.text) ? 1e6 : /thousand/i.test(unit.text) ? 1e3 : 1;
        if (observed !== rule.toleranceScale) throw new Error("Guidance tolerance unit mismatch");
        delta = tolerance * rule.toleranceScale;
      }
      metric.point = value; metric.low = value - delta; metric.high = value + delta;
      metric.derivation = "midpoint_plus_minus";
    }
    if (rule.pointIndex !== undefined) {
      if (!Number.isInteger(rule.pointIndex) || rule.pointIndex < 0 || !cells[rule.pointIndex]) throw new Error("Guidance point missing");
      metric.point = cells[rule.pointIndex].value * rule.scale;
      if (metric.point < metric.low! || metric.point > metric.high!) throw new Error("Guidance point outside range");
    }
    if (rule.approximate) metric.approximate = true;
  }
  metric.evidence = metric.evidence.map(item => ({ ...item, sourceUrl }));
  return metric;
}
export function extractEarnings(document: RawEarningsDocument, plan: ExtractionPlan, extractedAt: string): ExtractionOutcome {
  try {
    if (document.textSha256 !== sha256(document.text)) throw new Error("Raw text integrity mismatch");
    if (!validTimestamp(extractedAt)) throw new Error("Invalid extraction time");
    const company = pilotCompany(document.source.companyId);
    // Identity must appear in the opening document context, not just in a later
    // customer, supplier or competitor mention.
    if (!company.aliases.some(alias => document.text.slice(0, 2500).toLowerCase().includes(alias.toLowerCase()))) throw new Error("Issuer not established in document heading");
    const classification = classifyEarningsTitle(document.source.title);
    if (classification === "calendar") return { status: "skipped", reason: "scheduled_announcement_is_not_results", sourceId: document.sourceId };
    const kind = classification === "unknown" ? plan.kind : classification;
    if (!kind || !["actual", "preliminary", "forecast"].includes(kind)) throw new Error("Unclassified filing: inspect actual release exhibit");
    if (plan.kind && classification !== "unknown" && classification !== plan.kind) throw new Error("Source classification conflicts with extraction plan");
    validatePeriod(plan.period);
    if (!plan.periodEvidence.length) throw new Error("Fiscal period needs source evidence");
    const periodEvidence = plan.periodEvidence.map(needle => evidence(document.text, needle));
    const periodText = periodEvidence.map(item => item.text).join(" ");
    if (document.source.companyId.startsWith("US:")) assertEnglishFiscalLabel(document.source.companyId, plan.period, document.text.slice(0, 10000), periodText);
    else assertChineseReportPeriod(plan.period, document.source.title, periodText);
    for (const rule of plan.metrics) {
      if (rule.kind === "forecast" && kind !== "forecast" && (!rule.period || !rule.periodEvidence?.length)) throw new Error("Guidance needs its own explicit target period and evidence");
    }
    // Only actual/preliminary observations must cover a completed period.
    const availableDate = document.source.publishedAt?.value.slice(0, 10) ?? document.source.filingDate ?? document.retrievedAt.slice(0, 10);
    if (kind !== "forecast" && plan.period.end > availableDate) throw new Error("Actual results cannot describe a future period");
    const metrics = plan.metrics.map(rule => extractMetric(document, rule, plan.period));
    for (const metric of metrics) {
      if (kind === "forecast" && metric.kind !== "forecast") throw new Error("Forecast document cannot emit actual results");
      if (kind === "preliminary" && metric.kind === "actual") throw new Error("Preliminary document cannot emit final results");
      if (metric.kind !== "forecast" && canonicalJson(metric.period) !== canonicalJson(plan.period)) throw new Error("Actual metric period differs from document period");
    }
    const actualRevenue = metrics.filter(metric => metric.name === "revenue" && metric.scope === "consolidated" && metric.kind === kind);
    if (actualRevenue.length !== 1) throw new Error("Exactly one consolidated revenue fact is required");
    const signatures = metrics.map(metric => JSON.stringify([metric.name, metric.scope, metric.segment, metric.period, metric.kind, metric.basis]));
    if (new Set(signatures).size !== signatures.length) throw new Error("Duplicate or conflicting metric slots");
    let announcementDate: string | null = null, announcementDateEvidence: Evidence | null = null;
    if (plan.announcementDate || plan.announcementDateEvidence) {
      if (!validDate(plan.announcementDate) || !plan.announcementDateEvidence) throw new Error("Announcement date needs explicit evidence");
      announcementDate = plan.announcementDate;
      announcementDateEvidence = evidence(document.text, plan.announcementDateEvidence);
      if (!datesInEvidence(announcementDateEvidence.text).has(announcementDate)) throw new Error("Announcement date conflicts with dated source evidence");
    }
    const groupId = stableId("earnings_period", [document.source.issuerId, plan.period, kind]);
    const eventId = stableId("earnings", [document.sourceId, plan.period, kind]);
    const record: EarningsRecord = { version: 1, type: "earnings.extracted", eventId,
      revisionId: stableId("earnings_revision", [eventId, document.rawSha256, document.textSha256, EARNINGS_PARSER_VERSION, plan, { ...document.source, firstSeenAt: undefined }]),
      groupId, sourceId: document.sourceId, companyId: document.source.companyId, issuerId: document.source.issuerId,
      kind, period: plan.period, periodEvidence, periodStartDerivation: plan.periodStartDerivation ?? "reviewed_fiscal_calendar", source: document.source, announcementDate, announcementDateEvidence,
      rawSha256: document.rawSha256, textSha256: document.textSha256, parserVersion: EARNINGS_PARSER_VERSION,
      extractedAt, completeness: document.completeness, metrics,
      warnings: ["reviewed_pilot_adapter", ...(document.completeness === "excerpt" ? ["excerpt_not_full_document_coverage"] : [])],
      coverage: { revenue: "extracted", segments: metrics.some(m => m.scope === "segment") ? "extracted" : "not_extracted", guidance: metrics.some(m => m.kind === "forecast") ? "extracted" : "not_extracted" },
      ...(document.source.correctionOf ? { supersedes: document.source.correctionOf } : {}) };
    return { status: "extracted", record };
  } catch (error) {
    return { status: "review_required", reason: error instanceof Error ? error.message : "Extraction failed", sourceId: document.sourceId };
  }
}
