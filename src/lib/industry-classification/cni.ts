import {validateCatalog, type ClassificationEntry, type ClassificationMetadata, type TaxonomyCatalog, type TaxonomyNode} from './model';

export function cniCatalogVersion(snapshot: string) {
  const match = /^(\d{4})-(\d{1,2})$/.exec(snapshot);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw Error('Invalid CNI snapshot');
  // This identifies a directory-derived catalog, not an asserted methodology edition.
  return `cni-directory-${match[1]}-${match[2].padStart(2, '0')}`;
}

export function cniMetadata(sourceUrl: string, sourceSnapshot: string, observedAt: string): ClassificationMetadata {
  if (!sourceUrl.startsWith('https://www.cnindex.com.cn/zh_information/data_resource/fljg/')
    || !Number.isFinite(Date.parse(observedAt))) throw Error('Invalid CNI provenance');
  return {catalogVersion: cniCatalogVersion(sourceSnapshot), sourceUrl, sourceSnapshot, observedAt};
}

/** Extract only the categories actually present in an official company snapshot. */
export function buildCniCatalog(sourceUrl: string, snapshot: string, rows: {classification: ClassificationEntry[]}[]): TaxonomyCatalog {
  const nodes = new Map<string, TaxonomyNode>();
  for (const row of rows) {
    if (!Array.isArray(row.classification) || row.classification.length !== 4) throw Error('Invalid CNI classification path');
    row.classification.forEach((entry, index) => {
      const node: TaxonomyNode = {...entry, translations: {}, level: `level${index + 1}`, parentCode: index ? row.classification[index - 1].code : null};
      const prior = nodes.get(entry.code);
      if (prior && JSON.stringify(prior) !== JSON.stringify(node)) throw Error(`Conflicting CNI category: ${entry.code}`);
      nodes.set(entry.code, node);
    });
  }
  return validateCatalog({taxonomy: 'CNI', version: cniCatalogVersion(snapshot), sourceUrl, nodes: [...nodes.values()].sort((a, b) => a.code.localeCompare(b.code))});
}
