/** Only map known listing venues; never guess an exchange from a ticker. */
export function tradingViewSymbol(ticker: string, exchange?: string | null): string | null {
  const cn = /^(XSHG|XSHE):(\d{6})$/.exec(ticker);
  if (cn) return `${cn[1] === 'XSHG' ? 'SSE' : 'SZSE'}:${cn[2]}`;
  const venues: Record<string, string> = {
    NASDAQ: 'NASDAQ', XNAS: 'NASDAQ', NYSE: 'NYSE', XNYS: 'NYSE',
    AMEX: 'AMEX', XASE: 'AMEX', 'NYSE MKT': 'AMEX', 'NYSE AMERICAN': 'AMEX',
    ARCA: 'AMEX', NYSEARCA: 'AMEX', 'NYSE ARCA': 'AMEX',
  };
  const venue = venues[(exchange ?? '').trim().toUpperCase()];
  const symbol = ticker.trim().toUpperCase();
  if (!venue || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(symbol)) return null;
  return `${venue}:${symbol.replace(/[.-]/g, '.')}`;
}
