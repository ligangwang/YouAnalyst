import { pinyin } from 'pinyin-pro';
export const PINYIN_SEARCH_VERSION = 1;
export const normalizeStockQuery = (value: string) => value.normalize('NFKC').trim().replace(/^\$/, '').toLowerCase();
export function stockNameTerms(data: Record<string, unknown>): string[] {
  const names = [data.name, data.legalName, ...Object.values(data.names && typeof data.names === 'object' ? data.names : {}), ...(Array.isArray(data.aliases) ? data.aliases : [])];
  return [...new Set(names.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(normalizeStockQuery))];
}
export function pinyinSearchFields(data: Record<string, unknown>) {
  const terms = new Set<string>();
  for (const name of stockNameTerms(data)) {
    if (!/\p{Script=Han}/u.test(name)) continue;
    for (const pattern of ['first', 'pinyin'] as const) {
      const value = pinyin(name, { toneType: 'none', pattern, nonZh: 'removed', v: true }).replace(/\s+/g, '').toLowerCase();
      if (value) terms.add(value);
    }
  }
  const prefixes = new Set<string>();
  for (const term of terms) for (let start = 0; start < term.length; start++) {
    for (let length = 1; length <= Math.min(32, term.length - start); length++) {
      if (prefixes.size >= 2000) break;
      prefixes.add(term.slice(start, start + length));
    }
  }
  return { pinyinSearchTerms: [...terms], pinyinSearchPrefixes: [...prefixes], pinyinSearchVersion: PINYIN_SEARCH_VERSION };
}
