// Stable curated slugs; do not derive URLs from mutable company display names.
export const PUBLIC_COMPANY_SLUGS: Record<string, string> = {
  MSFT: "microsoft", NVDA: "nvidia", AMZN: "amazon", LLY: "eli-lilly",
  AAPL: "apple", GOOGL: "alphabet", META: "meta", TSLA: "tesla",
  AVGO: "broadcom", JPM: "jpmorgan", V: "visa", UNH: "unitedhealth",
  COST: "costco", XOM: "exxon-mobil", CAT: "caterpillar", AMD: "amd",
  PLTR: "palantir", NVO: "novo-nordisk", HD: "home-depot", GE: "ge-aerospace",
};

export function publicCompanyPath(symbol: string): string {
  const ticker = symbol.trim().replace(/^\$/, "").toUpperCase();
  return `/company/${PUBLIC_COMPANY_SLUGS[ticker] ?? `ticker-${encodeURIComponent(ticker.toLowerCase())}`}`;
}

export function publicCompanyTicker(slug: string): string | null {
  const key = slug.toLowerCase();
  const known = Object.entries(PUBLIC_COMPANY_SLUGS).find(([ticker, name]) => name === key || ticker.toLowerCase() === key);
  if (known) return known[0];
  return /^ticker-([a-z0-9][a-z0-9.-]{0,15})$/.exec(key)?.[1].toUpperCase() ?? null;
}
