import { pinyin } from 'pinyin-pro';
export const normalizeStockQuery = (value: string) => value.normalize('NFKC').trim().replace(/^\$/, '').toLowerCase();
export function stockNameTerms(data: Record<string, unknown>): string[] {
  const names = [data.name, ...Object.values(data.names && typeof data.names === 'object' ? data.names : {}), ...(Array.isArray(data.aliases) ? data.aliases : []), data.legalName];
  return [...new Set(names.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(normalizeStockQuery))];
}
export function companyPinyinTerms(data: Record<string, unknown>): string[] {
  const terms = new Set<string>();
  for (const name of stockNameTerms(data)) {
    if (!/\p{Script=Han}/u.test(name)) continue;
    for (const pattern of ['first', 'pinyin'] as const) {
      const value = pinyin(name, { toneType: 'none', pattern, nonZh: 'removed', v: true }).replace(/\s+/g, '').toLowerCase();
      if (value) terms.add(value);
    }
  }
  return [...terms];
}
