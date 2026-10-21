/** Company assignments remain separate from research topics and theme membership. */
export type Taxonomy = 'SIC' | 'CNI';
export type ClassificationEntry = { code: string; name: string };
export type ClassificationMetadata = {
  catalogVersion: string;
  sourceUrl: string;
  sourceSnapshot?: string;
  observedAt: string;
};
export type CompanyClassification = {
  taxonomy: Taxonomy;
  /** Assigned codes only; names and ancestors are resolved from the static catalog. */
  classification: string[];
  /** Optional while existing documents are migrated through normal imports. */
  classificationMetadata?: ClassificationMetadata;
};
export type TaxonomyNode = ClassificationEntry & {
  translations: Partial<Record<'en' | 'zh-CN', string>>;
  level: string;
  parentCode: string | null;
};
export type TaxonomyCatalog = {
  taxonomy: Taxonomy; version: string; sourceUrl: string; nodes: TaxonomyNode[];
};
export type IndustryMapping = {
  sicCode: string; cniCode: string;
  relation: 'equivalent' | 'sic_broader' | 'sic_narrower' | 'overlap';
  evidenceUrls: string[]; reviewedAt: string;
};
export type IndustryMappingFile = {
  version: string; sicCatalogVersion: string; cniCatalogVersion: string;
  mappings: IndustryMapping[];
};

const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const httpUrl = (v: unknown) => {
  try { return typeof v === 'string' && ['https:', 'http:'].includes(new URL(v).protocol); }
  catch { return false; }
};

/** Validate files once when loading; all hierarchy traversal is in memory. */
export function validateCatalog(catalog: TaxonomyCatalog): TaxonomyCatalog {
  if (!catalog || !['SIC', 'CNI'].includes(catalog.taxonomy) || !nonempty(catalog.version)
    || !httpUrl(catalog.sourceUrl) || !Array.isArray(catalog.nodes) || !catalog.nodes.length) throw Error('Invalid taxonomy catalog');
  const byCode = new Map<string, TaxonomyNode>();
  for (const node of catalog.nodes) {
    if (!node || !nonempty(node.code) || !nonempty(node.name) || !nonempty(node.level)
      || !(node.parentCode === null || nonempty(node.parentCode)) || byCode.has(node.code)
      || !node.translations || typeof node.translations !== 'object'
      || Array.isArray(node.translations) || Object.entries(node.translations).some(([key, value]) => !['en', 'zh-CN'].includes(key) || !nonempty(value))) throw Error('Invalid or duplicate taxonomy node');
    byCode.set(node.code, node);
  }
  for (const node of catalog.nodes) {
    const visited = new Set<string>();
    let current: TaxonomyNode | undefined = node;
    while (current) {
      if (visited.has(current.code)) throw Error('Taxonomy hierarchy cycle');
      visited.add(current.code);
      if (current.parentCode === null) break;
      current = byCode.get(current.parentCode);
      if (!current) throw Error('Unknown taxonomy parent');
    }
  }
  return catalog;
}

export function classificationPath(catalog: TaxonomyCatalog, code: string, locale: 'en' | 'zh-CN' = 'en'): ClassificationEntry[] {
  validateCatalog(catalog);
  const byCode = new Map(catalog.nodes.map(node => [node.code, node]));
  let node = byCode.get(code);
  if (!node) throw Error(`Unknown ${catalog.taxonomy} code: ${code}`);
  const path: ClassificationEntry[] = [];
  while (node) {
    path.unshift({code: node.code, name: node.translations[locale] ?? node.name});
    node = node.parentCode === null ? undefined : byCode.get(node.parentCode);
  }
  return path;
}

export function validateMappings(file: IndustryMappingFile, sic: TaxonomyCatalog, cni: TaxonomyCatalog) {
  validateCatalog(sic); validateCatalog(cni);
  if (!file || !nonempty(file.version) || sic.taxonomy !== 'SIC' || cni.taxonomy !== 'CNI'
    || file.sicCatalogVersion !== sic.version || file.cniCatalogVersion !== cni.version
    || !Array.isArray(file.mappings)) throw Error('Mapping catalog version mismatch');
  const sicCodes = new Set(sic.nodes.map(n => n.code)), cniCodes = new Set(cni.nodes.map(n => n.code));
  const pairs = new Set<string>();
  for (const mapping of file.mappings) {
    if (!mapping || !sicCodes.has(mapping.sicCode) || !cniCodes.has(mapping.cniCode)
      || !['equivalent', 'sic_broader', 'sic_narrower', 'overlap'].includes(mapping.relation)
      || !Array.isArray(mapping.evidenceUrls) || !mapping.evidenceUrls.length || !mapping.evidenceUrls.every(httpUrl)
      || typeof mapping.reviewedAt !== 'string' || !Number.isFinite(Date.parse(mapping.reviewedAt))) throw Error('Invalid industry mapping');
    const key = JSON.stringify([mapping.sicCode, mapping.cniCode]);
    if (pairs.has(key)) throw Error('Duplicate industry mapping pair');
    pairs.add(key);
  }
  return file;
}
