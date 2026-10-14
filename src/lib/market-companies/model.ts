import { companySearchFields } from "./search";
import { COMPANY_LINK_SLUGS } from './slugs';
import { nameSlug, validCompanySlug } from './slug-plan';
export const COMPANY_COLLECTION = "companies";
export function companyFields(id: string, data: Record<string, unknown>) {
  const symbol = String(data.symbol ?? (id.startsWith("ORG:") ? "" : id.split(":").at(-1)) ?? "");
  const name = String(data.name ?? symbol);
  const market = id.startsWith("US:") ? "US" : /^(XSHG|XSHE):/.test(id) ? "CN_A" : "GLOBAL";
  const normalized = (s: string) => s.normalize("NFKC").toLowerCase();
  // Preserve URL identity when translations, display names, or listing data change.
  const english = data.names && typeof data.names === 'object' ? (data.names as Record<string,unknown>).en : undefined;
  const base = nameSlug(typeof english === 'string' ? english : name);
  const qualifier=nameSlug(id.replace(':','-'));
  const slug = validCompanySlug(data.slug) ? data.slug : COMPANY_LINK_SLUGS[id] ?? `${base.slice(0,119-qualifier.length).replace(/-$/,'')}-${qualifier}`;
  return { ...companySearchFields(id,data), id, market, symbol, name, ...(validCompanySlug(slug)?{slug}:{}), symbolLower: normalized(symbol), nameLower: normalized(name) };
}

/** Name edits update search metadata without rewriting identity/listing fields. */
export function companyNameSearchFields(id: string, data: Record<string, unknown>) {
  return companySearchFields(id, data);
}
