export type PredictionMarket = "US" | "CN_A";

export function predictionInstrument(raw: string) {
  const ticker = raw.trim().toUpperCase();
  const china = /^(XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(ticker);
  if (china) {
    const [exchange, symbol] = ticker.split(":");
    return { ticker, companyId: ticker, market: "CN_A" as const, currency: "CNY", timeZone: "Asia/Shanghai", providerSymbol: `${symbol}.${exchange === "XSHG" ? "SHG" : "SHE"}`, exchange };
  }
  if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) return null;
  return { ticker, companyId: `US:${ticker}`, market: "US" as const, currency: "USD", timeZone: "America/New_York", providerSymbol: `${ticker}.US`, exchange: "US" };
}

export function marketDate(market: PredictionMarket, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: market === "CN_A" ? "Asia/Shanghai" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Never assign today's already-known Chinese close to a new call or close request.
// Holidays and suspensions are handled by requiring an actual dated EOD bar.
export function chinaTargetDate(now = new Date()) {
  const date = marketDate("CN_A", now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 15) return date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function formatCallPrice(value: number, ticker: string, maximumFractionDigits = 6) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: predictionInstrument(ticker)?.currency ?? "USD", minimumFractionDigits: 2, maximumFractionDigits }).format(value);
}
