import { companySlugPath, organizationCompanyPath, publicCompanyPath } from "./slugs";

export function chinaCompanyId(value: string): string | null {
  const id = value.trim().toUpperCase();
  if (/^(XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id)) return id;
  if (/^[036]\d{5}$/.test(id)) return `${id[0] === "6" ? "XSHG" : "XSHE"}:${id}`;
  return null;
}

export function companyPageUrl(symbol: string, market?: string, slug?:unknown): string {
  const id = symbol.startsWith('ORG:') || symbol.startsWith('US:') || chinaCompanyId(symbol) ? chinaCompanyId(symbol) ?? symbol : `US:${symbol.toUpperCase()}`;
  const canonical = companySlugPath(id,slug);
  if (canonical) return canonical;
  if (market === "GLOBAL" || symbol.startsWith("ORG:")) return organizationCompanyPath(symbol);
  // Feed and watchlist callers may have an exchange-qualified ID without a market.
  const cn = chinaCompanyId(symbol);
  return cn ? `/ticker/${cn}` : publicCompanyPath(symbol);
}
