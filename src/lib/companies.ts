import { featuredCompanies } from "./featured-companies";

// Explicit, stable slugs: changing a display name must not break a company URL.
const COMPANY_SLUGS: Record<string, string> = {
  MSFT: "microsoft", NVDA: "nvidia", AMZN: "amazon", LLY: "eli-lilly",
  AAPL: "apple", GOOGL: "alphabet", META: "meta", TSLA: "tesla",
  AVGO: "broadcom", JPM: "jpmorgan", V: "visa", UNH: "unitedhealth",
  COST: "costco", XOM: "exxon-mobil", CAT: "caterpillar", AMD: "amd",
  PLTR: "palantir", NVO: "novo-nordisk", HD: "home-depot", GE: "ge-aerospace",
};

export const companyDirectory = featuredCompanies.map((company) => ({
  ...company,
  slug: COMPANY_SLUGS[company.symbol],
}));

export function companyPath(rawTicker: string): string {
  const ticker = rawTicker.trim().replace(/^\$/, "").toUpperCase();
  return `/company/${COMPANY_SLUGS[ticker] ?? `ticker-${encodeURIComponent(ticker.toLowerCase())}`}`;
}

export function resolveCompanySlug(rawSlug: string) {
  const slug = rawSlug.toLowerCase();
  const known = companyDirectory.find((company) => company.slug === slug || company.symbol.toLowerCase() === slug);
  if (known) return known;
  const match = /^ticker-([a-z0-9][a-z0-9.-]{0,9})$/.exec(slug);
  if (!match) return null;
  const symbol = match[1].toUpperCase();
  return companyDirectory.find((company) => company.symbol === symbol) ?? {
    symbol, name: symbol, slug: `ticker-${symbol.toLowerCase()}`,
    sector: null, thesis: null,
  };
}

export function companyPathByName(name: string): string | null {
  const normalize = (value: string) => value.toLowerCase()
    .replace(/[.,]/g, "").replace(/\b(incorporated|inc|corporation|corp|limited|ltd|plc)\b/g, "")
    .replace(/\s+/g, " ").trim();
  const key = normalize(name);
  const company = companyDirectory.find((item) => normalize(item.name) === key || item.symbol.toLowerCase() === key);
  return company ? companyPath(company.symbol) : null;
}
