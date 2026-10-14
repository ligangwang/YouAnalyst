import { COMPANY_LINK_SLUGS } from './slugs';
import { nameSlug, validCompanySlug } from './slug-plan';
export const COMPANY_COLLECTION = "companies";
export function companyFields(id: string, data: Record<string, unknown>) {
  const symbol = String(data.symbol ?? (id.startsWith("ORG:") ? "" : id.split(":").at(-1)) ?? "");
  const name = String(data.name ?? symbol);
  const market = id.startsWith("US:") ? "US" : /^(XSHG|XSHE):/.test(id) ? "CN_A" : "GLOBAL";
  const normalized = (s: string) => s.normalize("NFKC").toLowerCase();
  const prefixes = new Set<string>();
  const names = Object.values(data.names && typeof data.names === "object" ? data.names : {}).filter((v): v is string => typeof v === "string");
  const aliases = Array.isArray(data.aliases) ? data.aliases.filter((v): v is string => typeof v === "string") : [];
  for (const word of [id, symbol, name, ...names, ...aliases, ...[name,...names,...aliases].flatMap(n => n.split(/[\s.,&-]+/))]) {
    const value = normalized(word);
    for (let start = 0; start < value.length; start++) {
      for (let size = 1; size <= Math.min(32, value.length - start); size++) prefixes.add(value.slice(start, start + size));
    }
  }
  // Preserve URL identity when translations, display names, or listing data change.
  const english = data.names && typeof data.names === 'object' ? (data.names as Record<string,unknown>).en : undefined;
  const base = nameSlug(typeof english === 'string' ? english : name);
  const slug = validCompanySlug(data.slug) ? data.slug : COMPANY_LINK_SLUGS[id] ?? `${base}-${nameSlug(id.replace(':','-'))}`;
  return { id, market, symbol, name, ...(validCompanySlug(slug)?{slug}:{}), symbolLower: normalized(symbol), nameLower: normalized(name), searchPrefixes: [...prefixes].slice(0, 4000),
    symbolPrefixes: Array.from({length:symbol.length}, (_, i) => normalized(symbol.slice(0,i+1))) };
}
