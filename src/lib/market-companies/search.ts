import { companyPinyinTerms, normalizeStockQuery, stockNameTerms } from './pinyin-search';
export const COMPANY_SEARCH_VERSION = 2;
export const COMPANY_SEARCH_LIMIT = 6000;
export const RETIRED_COMPANY_SEARCH_FIELDS = ['symbolPrefixes', 'pinyinSearchPrefixes', 'pinyinSearchTerms', 'pinyinSearchVersion'] as const;
function* substrings(value: string) {
  for (let length = 1; length <= Math.min(32, value.length); length++) {
    for (let start = 0; start <= value.length - length; start++) yield value.slice(start, start + length);
  }
}
/** A single bounded index, distributed across names so long legal names cannot crowd out aliases. */
export function companySearchFields(id: string, data: Record<string, unknown>) {
  const searchTerms = [...new Set([...stockNameTerms(data), ...companyPinyinTerms(data)])];
  const symbol = String(data.symbol ?? (id.startsWith('ORG:') ? '' : id.split(':').at(-1)) ?? '');
  const values = [...new Set([id, symbol, ...searchTerms].flatMap(value => {
    const name = normalizeStockQuery(value);
    return [name, name.replace(/\s+/g, '')];
  }).filter(Boolean))];
  const prefixes = new Set(values.map(value => value.slice(0, 32)).slice(0, COMPANY_SEARCH_LIMIT));
  let iterators = values.map(substrings);
  while (iterators.length && prefixes.size < COMPANY_SEARCH_LIMIT) {
    const active: Generator<string>[] = [];
    for (const iterator of iterators) {
      const next = iterator.next();
      if (!next.done) { prefixes.add(next.value); active.push(iterator); }
      if (prefixes.size >= COMPANY_SEARCH_LIMIT) break;
    }
    iterators = active;
  }
  return { searchTerms, searchPrefixes: [...prefixes].sort(), searchIndexVersion: COMPANY_SEARCH_VERSION };
}
