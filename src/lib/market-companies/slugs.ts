import migratedSlugs from '../../../data/company-link-slugs.json';
// Small compatibility map only. Full inventory stays on the server; clients
// receive the relevant stored slug with their company data.
export const COMPANY_LINK_SLUGS: Record<string,string> = migratedSlugs;
const SLUG_IDS = new Map(Object.entries(COMPANY_LINK_SLUGS).map(([id,slug])=>[slug,id]));
export function companyIdFromSlug(slug:string):string|null { return SLUG_IDS.get(slug.toLowerCase()) ?? null; }
export function companySlugPath(id:string, slug?:unknown):string|null {
  const value = typeof slug === 'string' && slug.length<=120 && slug===slug.toLowerCase() && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) && !slug.startsWith('ticker-') ? slug : COMPANY_LINK_SLUGS[id]
    ?? (id.startsWith('US:')?PUBLIC_COMPANY_SLUGS[id.slice(3)]:ORGANIZATION_COMPANY_SLUGS[id]);
  return value ? `/company/${encodeURIComponent(value)}` : null;
}
export const ORGANIZATION_COMPANY_SLUGS: Record<string, string> = {
  "ORG:OPENAI": "openai", "ORG:ANTHROPIC": "anthropic", "ORG:MISTRAL-AI": "mistral-ai",
  "ORG:SPACEX": "spacex", "ORG:BLUE-ORIGIN": "blue-origin", "ORG:AXIOM-SPACE": "axiom-space",
  "ORG:CESIUMASTRO": "cesiumastro", "ORG:D-ORBIT": "d-orbit", "ORG:VARDA-SPACE": "varda-space",
  "ORG:HON-HAI": "hon-hai", "ORG:QUANTA-COMPUTER": "quanta-computer",
  "ORG:SAMSUNG-ELECTRONICS": "samsung-electronics", "ORG:WISTRON": "wistron",
};
export function organizationCompanyPath(id: string): string {
  return companySlugPath(id.toUpperCase()) ?? `/companies?search=${encodeURIComponent(id.replace(/^ORG:/i,''))}`;
}
export function organizationCompanyId(slug: string): string | null {
  const id = companyIdFromSlug(slug);
  if (id?.startsWith('ORG:')) return id;
  return Object.entries(ORGANIZATION_COMPANY_SLUGS).find(([, name]) => name === slug.toLowerCase())?.[0] ?? null;
}
export const PUBLIC_COMPANY_SLUGS: Record<string, string> = {
  MSFT: "microsoft", NVDA: "nvidia", AMZN: "amazon", LLY: "eli-lilly",
  AAPL: "apple", GOOGL: "alphabet", META: "meta", TSLA: "tesla",
  AVGO: "broadcom", JPM: "jpmorgan", V: "visa", UNH: "unitedhealth",
  COST: "costco", XOM: "exxon-mobil", CAT: "caterpillar", AMD: "amd",
  PLTR: "palantir", NVO: "novo-nordisk", HD: "home-depot", GE: "ge-aerospace",
};

export function publicCompanyPath(symbol: string): string {
  const ticker = symbol.trim().replace(/^\$/, "").replace(/^US:/i,'').toUpperCase();
  return companySlugPath(`US:${ticker}`) ?? (PUBLIC_COMPANY_SLUGS[ticker] ? `/company/${PUBLIC_COMPANY_SLUGS[ticker]}` : `/ticker/${encodeURIComponent(ticker)}`);
}

export function publicCompanyTicker(slug: string): string | null {
  const key = slug.toLowerCase();
  if (COMPANY_LINK_SLUGS[`US:${key.toUpperCase()}`]) return key.toUpperCase();
  const id = companyIdFromSlug(key);
  if (id?.startsWith('US:')) return id.slice(3);
  const known = Object.entries(PUBLIC_COMPANY_SLUGS).find(([ticker, name]) => name === key || ticker.toLowerCase() === key);
  if (known) return known[0];
  return /^ticker-([a-z0-9][a-z0-9.-]{0,15})$/.exec(key)?.[1].toUpperCase() ?? null;
}
