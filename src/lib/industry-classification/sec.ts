import {createHash} from 'node:crypto';
import {validateCatalog, type ClassificationEntry, type CompanyClassification, type TaxonomyCatalog} from './model';
import {taxonomyCatalog, taxonomyNode} from './catalog';

export type SecCompanyPatch = Partial<CompanyClassification> & {cik?: string};
export function normalizedCik(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!/^\d{1,10}$/.test(String(value)) || Number(value) === 0) throw Error('Invalid stored CIK; review required');
  return String(value).padStart(10, '0');
}

/** Shared by initial population and later SEC resyncs. No observation-only writes. */
export function secCompanySyncPatch(previous: Record<string, unknown>, cik: string, entry: ClassificationEntry | null,
  catalogVersion: string, observedAt: string): SecCompanyPatch | null {
  if (previous.isDeleted === true) return null;
  if (!/^\d{10}$/.test(cik) || Number(cik) === 0) throw Error('Invalid SEC CIK');
  const stored = normalizedCik(previous.cik);
  if (stored && stored !== cik) throw Error('SEC CIK conflict; review required');
  const patch: SecCompanyPatch = previous.cik === cik ? {} : {cik};
  // CIK is independent of SIC availability. Missing SIC never erases old data.
  if (entry && (!previous.taxonomy || previous.taxonomy === 'SIC')) {
    Object.assign(patch, secClassificationPatch(previous, entry, cik, catalogVersion, observedAt) ?? {});
  }
  return Object.keys(patch).length ? patch : null;
}

export function indexSecBulk(rows: unknown[]) {
  const issuers = new Map<string, ClassificationEntry | null>(), tickers = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const value of rows) {
    const row = value as Record<string, unknown>;
    const cik = String(row?.cik).padStart(10, '0');
    if (!/^\d{10}$/.test(cik) || Number(cik) === 0 || !Array.isArray(row.tickers)) throw Error('Invalid SEC bulk issuer');
    // Non-listed historical filers can contain obsolete SICs with no description.
    // They cannot participate in ticker matching, so do not import their categories.
    const entry = !row.tickers.length && !row.sicDescription ? null : parseSecClassification(row, cik);
    if (issuers.has(cik)) throw Error('Duplicate SEC bulk issuer');
    issuers.set(cik, entry);
    for (const ticker of row.tickers) {
      if (typeof ticker !== 'string' || !ticker.trim()) throw Error('Invalid SEC bulk ticker');
      const key = ticker.toUpperCase().replace(/-/g, '.');
      if (tickers.has(key) && tickers.get(key) !== cik) ambiguous.add(key);
      tickers.set(key, cik);
    }
  }
  for (const ticker of ambiguous) tickers.delete(ticker);
  return {issuers, tickers, ambiguous};
}

export function parseSecClassification(value: unknown, expectedCik: string): ClassificationEntry | null {
  const row = value as Record<string, unknown> | null;
  if (!/^\d{10}$/.test(expectedCik) || !row || !/^\d{1,10}$/.test(String(row.cik))
    || String(row.cik).padStart(10, '0') !== expectedCik) throw Error('SEC classification CIK mismatch');
  if (row.sic === undefined || row.sic === null || row.sic === '' || Number(row.sic) === 0) return null;
  if (!/^\d{1,4}$/.test(String(row.sic)) || typeof row.sicDescription !== 'string' || !row.sicDescription.trim()) throw Error('Invalid SEC SIC classification');
  return {code: String(row.sic).padStart(4, '0'), name: row.sicDescription.trim()};
}

/** SEC also reports broad/special codes. Preserve the reported node without guessing parents. */
export function buildSecCatalog(entries: ClassificationEntry[]): TaxonomyCatalog {
  const nodes = new Map<string, ClassificationEntry>();
  for (const entry of entries) {
    const previous = nodes.get(entry.code);
    if (previous && previous.name !== entry.name) throw Error(`Conflicting SEC SIC description: ${entry.code}`);
    nodes.set(entry.code, entry);
  }
  const ordered = [...nodes.values()].sort((a, b) => a.code.localeCompare(b.code));
  const hash = createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
  return validateCatalog({taxonomy: 'SIC', version: `sec-sic-observed-${hash}`, sourceUrl: 'https://data.sec.gov/submissions/',
    nodes: ordered.map(entry => ({...entry, translations: {}, level: 'secReportedIndustry', parentCode: null}))});
}

export function secClassificationPatch(previous: Record<string, unknown>, entry: ClassificationEntry, cik: string,
  _catalogVersion: string, observedAt: string): CompanyClassification | null {
  if (previous.isDeleted === true) return null;
  if (previous.taxonomy && previous.taxonomy !== 'SIC') throw Error('Refusing to replace another taxonomy');
  if (!taxonomyNode('SIC',entry.code)) throw Error(`SIC catalog update required: ${entry.code}`);
  if (!/^\d{10}$/.test(cik) || !Number.isFinite(Date.parse(observedAt))) throw Error('Invalid SEC classification provenance');
  const sourceUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const metadata = previous.classificationMetadata as CompanyClassification['classificationMetadata'];
  const path = previous.classification as unknown[] | undefined;
  // Names belong to the catalog; observation/name-only changes do not rewrite companies.
  if (previous.taxonomy === 'SIC' && path?.length === 1 && path[0] === entry.code
    && metadata?.sourceUrl === sourceUrl && metadata.catalogVersion && metadata.observedAt) return null;
  return {taxonomy: 'SIC', classification: [entry.code], classificationMetadata: {catalogVersion:taxonomyCatalog('SIC').version, sourceUrl, observedAt}};
}
