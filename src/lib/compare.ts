import {ComparisonCoverageError} from './compare-error';
export const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"];
export const COMPARE_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#facc15", "#60a5fa", "#f87171", "#a3e635", "#e2e8f0"];
export const COMPARE_LIGHT_COLORS = ["#087e99", "#7540b7", "#087b56", "#ba4d08", "#b52e76", "#896500", "#2563b0", "#bc3343", "#537c12", "#475569"];
export type CompareStyle = "line" | "bar";
export function compareSymbol(value: string): boolean {
  return /^(?:[A-Z][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(value);
}
export type CompareConfig = { symbols: string[]; start: string; end: string; style: CompareStyle; colors?: Record<string, string> };
export type PricePoint = { date: string; close: number };
export type CompareData = {
  dates: string[];
  series: { symbol: string; values: number[] }[];
  frequency: "Daily" | "Weekly" | "Monthly";
  source: string;
};

export function isoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// Stored EOD rows determine the actual latest trading day, including today's close.
export function latestCompareDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function yearsBefore(date: string, years: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() - years);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result.toISOString().slice(0, 10);
}

export function parseCompareConfig(params: URLSearchParams, now = new Date()): CompareConfig {
  const endDefault = latestCompareDate(now);
  const symbols = [...new Set((params.get("symbols") ?? DEFAULT_SYMBOLS.join(",")).toUpperCase().split(",").map(s => s.trim()).filter(compareSymbol))].slice(0, 10);
  const end = params.get("end") ?? endDefault;
  const start = params.get("start") ?? yearsBefore(isoDate(end) ? end : endDefault, 1);
  const colorValues = params.get("colors")?.split(",");
  const colors = colorValues?.length === symbols.length && colorValues.every(color => /^[\da-f]{6}$/i.test(color))
    ? Object.fromEntries(symbols.map((symbol, index) => [symbol, `#${colorValues[index].toLowerCase()}`])) : undefined;
  return {
    symbols: symbols.length ? symbols : DEFAULT_SYMBOLS,
    start: isoDate(start) ? start : yearsBefore(endDefault, 1),
    end: isoDate(end) ? end : endDefault,
    style: params.get("style") === "bar" ? "bar" : "line",
    ...(colors ? { colors } : {}),
  };
}

export function comparePath(config: CompareConfig): string {
  const params = new URLSearchParams({ symbols: config.symbols.join(","), start: config.start, end: config.end, style: config.style });
  if (config.colors && config.symbols.every(symbol => /^#[\da-f]{6}$/i.test(config.colors![symbol] ?? ""))) {
    params.set("colors", config.symbols.map(symbol => config.colors![symbol].slice(1)).join(","));
  }
  return `/compare?${params}`;
}

export function validateCompareConfig(config: CompareConfig, now = new Date()): string | null {
  if (config.symbols.length < 1 || config.symbols.length > 10 || config.symbols.some(s => !compareSymbol(s))) return "Choose between 1 and 10 valid stock tickers.";
  if (!isoDate(config.start) || !isoDate(config.end) || config.start >= config.end) return "Choose a start date before the end date.";
  if (config.end > latestCompareDate(now)) return "Choose an end date no later than today; comparisons use stored daily closes.";
  if (config.start < yearsBefore(config.end, 15)) return "Choose a period of 15 years or less.";
  return null;
}

export function buildComparison(histories: { symbol: string; points: PricePoint[] }[], config: CompareConfig): CompareData {
  const maps = histories.map(h => new Map(h.points.filter(p => p.date >= config.start && p.date <= config.end && Number.isFinite(p.close) && p.close > 0).map(p => [p.date, p.close])));
  const commonDates = [...(maps[0]?.keys() ?? [])].filter(date => maps.every(m => m.has(date))).sort();
  if (commonDates.length < 2) throw new ComparisonCoverageError("These stocks need at least two shared trading days in this period. Try an earlier start date or another selection.");
  const frequency = config.start < yearsBefore(config.end, 5) ? "Monthly" : config.start < yearsBefore(config.end, 2) ? "Weekly" : "Daily";
  const bucket = (date: string) => {
    if (frequency === "Monthly") return date.slice(0, 7);
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  };
  // Keep each period's last common close and always preserve the exact endpoints.
  const dates = commonDates.filter((date, i) => frequency === "Daily" || i === 0 || i === commonDates.length - 1 || bucket(date) !== bucket(commonDates[i + 1]));
  return {
    dates,
    frequency,
    source: "YouAnalyst EOD",
    series: histories.map((history, i) => {
      const base = maps[i].get(dates[0])!;
      return { symbol: history.symbol, values: dates.map(date => (maps[i].get(date)! / base - 1) * 100) };
    }),
  };
}

export function returnLabel(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
