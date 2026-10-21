import sic from './catalogs/sic-bilingual.json';
import cni from './catalogs/cni-bilingual.json';
import {validateCatalog, type Taxonomy, type TaxonomyCatalog, type ClassificationEntry} from './model';

export type ClassificationLocale = 'en' | 'zh-CN';
const catalogs = {SIC: validateCatalog(sic as TaxonomyCatalog), CNI: validateCatalog(cni as TaxonomyCatalog)};
const indexes = Object.fromEntries(Object.entries(catalogs).map(([taxonomy,catalog]) => {
  for (const node of catalog.nodes) {
    if (!node.translations.en || !node.translations['zh-CN']) throw Error(`Missing taxonomy translation: ${taxonomy}:${node.code}`);
  }
  return [taxonomy,new Map(catalog.nodes.map(node=>[node.code,node]))];
})) as Record<Taxonomy, Map<string, TaxonomyCatalog['nodes'][number]>>;

export function taxonomyCatalog(taxonomy: Taxonomy) { return catalogs[taxonomy]; }
export function taxonomyNode(taxonomy: Taxonomy, code: string) { return indexes[taxonomy]?.get(code); }
export function industryPath(taxonomy: Taxonomy, code: string, locale: ClassificationLocale = 'en'): ClassificationEntry[] {
  let node=taxonomyNode(taxonomy,code);
  if (!node) throw Error(`Unknown ${taxonomy} code: ${code}`);
  const path: ClassificationEntry[]=[];
  while(node) { path.unshift({code:node.code,name:node.translations[locale]!}); node=node.parentCode?taxonomyNode(taxonomy,node.parentCode):undefined; }
  return path;
}

/** Dual-format reader for rolling deployments. Legacy arrays are a single ancestor path. */
export function assignedClassificationCodes(taxonomy: Taxonomy, value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) return [];
  if (value.every(item=>typeof item==='string')) {
    const codes=[...new Set(value as string[])];
    for(const code of codes) if(!taxonomyNode(taxonomy,code)) throw Error(`Unknown ${taxonomy} code: ${code}`);
    return codes;
  }
  if (!value.every(item=>item && typeof item==='object' && typeof item.code==='string')) throw Error('Invalid classification');
  const codes=value.map(item=>item.code as string),leaf=codes.at(-1)!;
  const path=industryPath(taxonomy,leaf).map(item=>item.code);
  // Reject unrelated branches instead of silently dropping assignments.
  if (codes.some((code,i)=>!path.includes(code) || (i>0 && path.indexOf(code)<=path.indexOf(codes[i-1])))) throw Error('Invalid legacy classification path');
  return [leaf];
}

export function companyClassificationPaths(company: {taxonomy?: unknown; classification?: unknown}, locale: ClassificationLocale = 'en') {
  if (company.taxonomy!=='SIC' && company.taxonomy!=='CNI') return [];
  return assignedClassificationCodes(company.taxonomy,company.classification).map(code=>industryPath(company.taxonomy as Taxonomy,code,locale));
}
