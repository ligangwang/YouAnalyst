/** Firestore company keys match companies/{market:ticker}; provider payloads remain tickers. */
export const validFundamentalsTicker = (ticker: string) => /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker);

export function usFundamentalsId(ticker: string): string {
  if (!validFundamentalsTicker(ticker)) throw new Error(`Invalid US fundamentals ticker: ${ticker}`);
  return `US:${ticker}`;
}

export function usFundamentalsTicker(id: string): string | null {
  const ticker = id.startsWith("US:") ? id.slice(3) : "";
  return validFundamentalsTicker(ticker) ? ticker : null;
}
