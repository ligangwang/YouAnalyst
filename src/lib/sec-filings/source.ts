import { secRequest } from "../sec-request";
import { createSecFilingDiscovered, isSecFilingDate, isSecFinancialForm, sourcePublication, type SecFinancialForm } from "./event";

export type SecFiling = { accessionNumber: string; form: SecFinancialForm; filingDate: string; primaryDocument: string; isXbrl: boolean; published_at?:string|null };
export type SecSubmissionsFile = { name: string; filingFrom: string; filingTo: string };
export type SecSubmissions = { recent: SecFiling[]; files: SecSubmissionsFile[] };
export type SecFilingsSource = {
  resolveCik(companyId: string): Promise<string>;
  submissions(cik: string): Promise<SecSubmissions>;
  archive(cik: string, name: string): Promise<SecFiling[]>;
};

export function parseSecFilingRows(value: unknown): SecFiling[] {
  const v = value as Record<string, unknown> | null;
  const keys = ["accessionNumber", "form", "filingDate", "primaryDocument"] as const;
  if (!v || !keys.every(key => Array.isArray(v[key]))
    || !keys.every(key => (v[key] as unknown[]).length === (v.accessionNumber as unknown[]).length)) {
    throw new Error("Invalid SEC submissions columns; cursor not advanced");
  }
  const rows: SecFiling[] = [];
  const accessions = new Map<string, SecFiling>();
  for (let i = 0; i < (v.form as unknown[]).length; i++) {
    const form = (v.form as unknown[])[i];
    if (!isSecFinancialForm(form)) continue;
    // Reuse the event boundary validation rather than letting a malformed financial
    // filing silently disappear when the collection watermark advances.
    const xbrl = Array.isArray(v.isXBRL) ? v.isXBRL[i] : undefined;
    const inline = Array.isArray(v.isInlineXBRL) ? v.isInlineXBRL[i] : undefined;
    const knownFlag = (flag: unknown) => flag === 0 || flag === 1 || flag === false || flag === true;
    if ((xbrl !== undefined && !knownFlag(xbrl)) || (inline !== undefined && !knownFlag(inline))
      || (!knownFlag(xbrl) && inline !== 1 && inline !== true)) {
      throw new Error("SEC financial filing has no reliable XBRL flag; cursor not advanced");
    }
    // Inline XBRL is itself XBRL. Missing metadata is never guessed to mean false.
    const isXbrl = xbrl === 1 || xbrl === true || inline === 1 || inline === true;
    const event = createSecFilingDiscovered({ companyId: "CHECK", cik: "0000000001", form, isXbrl,
      accessionNumber: (v.accessionNumber as string[])[i], filingDate: (v.filingDate as string[])[i],
      primaryDocument: (v.primaryDocument as string[])[i], discoveredAt: "2000-01-01T00:00:00Z" });
    const row = { accessionNumber: event.accessionNumber, form, filingDate: event.filingDate, primaryDocument: event.primaryDocument, isXbrl,
      published_at:sourcePublication(Array.isArray(v.acceptanceDateTime)?v.acceptanceDateTime[i]:null) };
    const previous = accessions.get(row.accessionNumber);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("Conflicting SEC accession metadata");
    if (!previous) rows.push(row);
    accessions.set(row.accessionNumber, row);
  }
  return rows;
}

export function parseSecSubmissions(value: unknown, cik: string): SecSubmissions {
  if (!/^\d{10}$/.test(cik) || Number(cik) === 0) throw new Error("Invalid requested SEC CIK");
  const v = value as { cik?: unknown; filings?: { recent?: unknown; files?: unknown } } | null;
  if (!v?.filings || !Array.isArray(v.filings.files)) throw new Error("Invalid SEC submissions index; cursor not advanced");
  if (!/^\d{1,10}$/.test(String(v.cik)) || String(v.cik).padStart(10, "0") !== cik) {
    throw new Error("SEC submissions CIK does not match requested issuer; cursor not advanced");
  }
  const files = v.filings.files.map((file: unknown) => {
    const f = file as Partial<SecSubmissionsFile> | null;
    if (!f || typeof f.name !== "string" || !new RegExp(`^CIK${cik}-submissions-\\d+\\.json$`).test(f.name)
      || !isSecFilingDate(f.filingFrom) || !isSecFilingDate(f.filingTo) || f.filingFrom > f.filingTo) {
      throw new Error("Invalid SEC submissions archive; cursor not advanced");
    }
    return { name: f.name, filingFrom: f.filingFrom, filingTo: f.filingTo };
  });
  return { recent: parseSecFilingRows(v.filings.recent), files };
}

export function parseSecTickerMapping(value: unknown): Map<string, string> {
  const v = value as { fields?: unknown; data?: unknown } | null;
  if (!v || !Array.isArray(v.fields) || !Array.isArray(v.data)) throw new Error("Invalid SEC company mapping");
  const tickerIndex = v.fields.indexOf("ticker"), cikIndex = v.fields.indexOf("cik");
  if (tickerIndex < 0 || cikIndex < 0) throw new Error("SEC company mapping is missing columns");
  const mapping = new Map<string, string>();
  for (const row of v.data) {
    if (!Array.isArray(row)) throw new Error("Invalid SEC company mapping row");
    const ticker = String(row[tickerIndex]).toUpperCase().replace(/-/g, ".");
    const cik = String(row[cikIndex]);
    if (!/^\d{1,10}$/.test(cik) || Number(cik) === 0) throw new Error("Invalid SEC company mapping CIK");
    const padded = cik.padStart(10, "0");
    if (mapping.has(ticker) && mapping.get(ticker) !== padded) throw new Error(`Ambiguous SEC company mapping for ${ticker}`);
    mapping.set(ticker, padded);
  }
  return mapping;
}

export type SecRawSubmissionsObserver = (cik: string, value: unknown, archive: (name: string) => Promise<unknown>) => Promise<void>;
export function createSecFilingsSource(userAgent: string, signal?: AbortSignal, observeRaw?: SecRawSubmissionsObserver): SecFilingsSource {
  if (!userAgent.trim()) throw new Error("SEC_USER_AGENT is required");
  const json = (url: string, cik?: string) => secRequest(url, {
    signal, headers: { accept: "application/json", "user-agent": userAgent },
  }, response => response.json() as Promise<unknown>, { cik, operation: "filing_discovery" });
  let mapping: Promise<Map<string, string>> | undefined;
  // One source instance belongs to one collector run. Pilot-priority discovery
  // and annual-fundamentals discovery share these exact responses and budget.
  const snapshots = new Map<string, Promise<unknown>>(), archives = new Map<string, Promise<unknown>>();
  const archive = (cik: string, name: string) => {
    if (!/^\d{10}$/.test(cik) || !new RegExp(`^CIK${cik}-submissions-\\d+\\.json$`).test(name)) throw new Error("Invalid SEC archive path");
    const key = `${cik}/${name}`;
    if (!archives.has(key)) archives.set(key, json(`https://data.sec.gov/submissions/${name}`, cik));
    return archives.get(key)!;
  };
  return {
    async resolveCik(companyId) {
      mapping ??= json("https://www.sec.gov/files/company_tickers_exchange.json").then(parseSecTickerMapping);
      const cik = (await mapping).get(companyId.replace(/-/g, "."));
      if (!cik) throw new Error(`No SEC CIK mapping for ${companyId}`);
      return cik;
    },
    async submissions(cik) {
      if (!/^\d{10}$/.test(cik)) throw new Error("Invalid CIK");
      if (!snapshots.has(cik)) snapshots.set(cik, json(`https://data.sec.gov/submissions/CIK${cik}.json`, cik));
      const value = await snapshots.get(cik)!, parsed = parseSecSubmissions(value, cik);
      try { await observeRaw?.(cik, value, name => archive(cik, name)); }
      catch {
        // The earnings sidecar cannot suppress already-validated financial
        // discovery, including when its own failure checkpoint cannot be saved.
        console.error(JSON.stringify({ severity: "ERROR", event: "earnings_observer_failed", cik, financialDiscoveryContinues: true }));
      }
      return parsed;
    },
    async archive(cik, name) {
      return parseSecFilingRows(await archive(cik, name));
    },
  };
}
