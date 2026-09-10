export type AnnualReport = {
  cik: string; accession: string; form: string; filed: string; end: string; url: string;
};
export type FundamentalMetric = {
  label: string; value: number | null; unit: string | null; start: string | null;
  end: string; filed: string | null; sourceUrl: string | null; tag: string | null;
};
export type CompanyFundamentals = {
  report: AnnualReport; metrics: FundamentalMetric[]; excerpt: string | null; fetchedAt: string; stale?: boolean;
};

type Fact = { val?: unknown; start?: string; end?: string; filed?: string; form?: string; accn?: string };
type Concept = { units?: Record<string, Fact[]> };
export type CompanyFacts = { cik?: number; facts?: Record<string, Record<string, Concept>> };
type Definition = { label: string; duration: boolean; tags: string[]; perShare?: boolean };
const definitions: Definition[] = [
  { label: "Revenue", duration: true, tags: ["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "us-gaap:Revenues", "us-gaap:SalesRevenueNet", "ifrs-full:Revenue"] },
  { label: "Net income", duration: true, tags: ["us-gaap:NetIncomeLoss", "ifrs-full:ProfitLoss"] },
  { label: "Diluted EPS", duration: true, perShare: true, tags: ["us-gaap:EarningsPerShareDiluted", "ifrs-full:DilutedEarningsLossPerShare"] },
  { label: "Operating cash flow", duration: true, tags: ["us-gaap:NetCashProvidedByUsedInOperatingActivities", "ifrs-full:CashFlowsFromUsedInOperatingActivities"] },
  { label: "Cash and equivalents", duration: false, tags: ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "ifrs-full:CashAndCashEquivalents"] },
  { label: "Total assets", duration: false, tags: ["us-gaap:Assets", "ifrs-full:Assets"] },
];
const annualForms = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const isoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const accession = (value: unknown): value is string => typeof value === "string" && /^\d{10}-\d{2}-\d{6}$/.test(value);

export function filingIndexUrl(cik: string, accn: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll("-", "")}/${accn}-index.html`;
}

export function latestAnnualReport(cik: string, payload: { filings?: { recent?: Record<string, unknown> } }): AnnualReport | null {
  const recent = payload.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return null;
  const cell = (key: string, i: number): unknown => Array.isArray(recent[key]) ? recent[key][i] : null;
  const reports: AnnualReport[] = [];
  recent.form.forEach((form, i) => {
    const accn = cell("accessionNumber", i), end = cell("reportDate", i), filed = cell("filingDate", i), document = cell("primaryDocument", i);
    // Amendments may omit statements or Item 1. Anchor to the latest original annual report.
    if (!["10-K", "20-F", "40-F"].includes(form) || !accession(accn) || !isoDate(end) || !isoDate(filed) || typeof document !== "string" || !/^[\w.-]+$/.test(document)) return;
    reports.push({ cik, accession: accn, form, filed, end, url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll("-", "")}/${document}` });
  });
  return reports.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0] ?? null;
}

export function annualMetrics(payload: CompanyFacts, report: AnnualReport): FundamentalMetric[] {
  return definitions.map(definition => {
    const empty: FundamentalMetric = { label: definition.label, value: null, unit: null, start: null, end: report.end, filed: null, sourceUrl: null, tag: null };
    if (Number(payload.cik) !== Number(report.cik)) return empty;
    for (const tag of definition.tags) {
      const [taxonomy, name] = tag.split(":");
      const concept = payload.facts?.[taxonomy]?.[name];
      const candidates = Object.entries(concept?.units ?? {}).flatMap(([unit, rows]) => {
        if (!(definition.perShare ? /^[A-Z]{3}\/shares$/ : /^[A-Z]{3}$/).test(unit) || !Array.isArray(rows)) return [];
        return rows.filter(fact => {
          if (typeof fact.val !== "number" || !Number.isFinite(fact.val) || fact.end !== report.end || !annualForms.has(fact.form ?? "") || !isoDate(fact.filed) || fact.filed < report.filed || !accession(fact.accn)) return false;
          if (!definition.duration) return !fact.start;
          if (!isoDate(fact.start)) return false;
          const days = (Date.parse(fact.end) - Date.parse(fact.start)) / 86_400_000;
          return days >= 350 && days <= 380; // Full 52/53-week year; never a quarter or YTD.
        }).map(fact => ({ fact, unit }));
      }).sort((a, b) => b.fact.filed!.localeCompare(a.fact.filed!));
      if (!candidates.length) continue;
      const latest = candidates.filter(candidate => candidate.fact.filed === candidates[0].fact.filed);
      // Ambiguous currencies, periods or values fail closed rather than picking an arbitrary row.
      if (new Set(latest.map(({ fact, unit }) => `${unit}:${fact.start ?? ""}:${fact.val}`)).size !== 1) return empty;
      const { fact, unit } = latest[0];
      return { ...empty, value: fact.val as number, unit, start: fact.start ?? null, filed: fact.filed!, sourceUrl: filingIndexUrl(report.cik, fact.accn!), tag };
    }
    return empty;
  });
}

export function businessExcerpt(section: string): string | null {
  // A quotation, not an AI summary. Skip headings/TOC and retain one readable opening paragraph.
  const paragraphs = section.split(/\n+/).map(value => value.replace(/\s+/g, " ").trim());
  const overview = paragraphs.findIndex(value => /^(?:company |business |corporate )?overview$|^general$|^our business$/i.test(value));
  const paragraph = paragraphs.slice(overview < 0 ? 0 : overview + 1).find(value => value.length >= 160
    && /\b(products?|services?|designs?|manufactur\w*|develop\w*|technology|solutions?)\b/i.test(value)
    && !/forward-looking|table of contents|voluntary disclosures|references in this|securities litigation|actual results|risk factors/i.test(value));
  if (!paragraph) return null;
  if (paragraph.length <= 700) return paragraph;
  const clipped = paragraph.slice(0, 700);
  const sentence = clipped.lastIndexOf(". ");
  return sentence >= 250 ? clipped.slice(0, sentence + 1) : `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
}
