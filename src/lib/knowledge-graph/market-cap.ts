import type { GraphMarketCap } from "./model";
// Area follows value between readability limits. Unknown values retain default size.
export function marketCapScale(cap?: GraphMarketCap): number {
  return cap && Number.isFinite(cap.value) && cap.value > 0
    ? Math.max(.65, Math.min(2.5, Math.sqrt(cap.value / 100_000_000_000))) : 1;
}
function compact(value: number, symbol: string) {
  const unit = value >= 1e12 ? [1e12, "T"] as const : value >= 1e9 ? [1e9, "B"] as const : [1e6, "M"] as const;
  return symbol + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value / unit[0]) + unit[1];
}
export function currencyValueLabel(value: number, currency: "USD" | "EUR"): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return compact(value, currency === "USD" ? "$" : "€");
}
export function marketCapLabel(cap?: GraphMarketCap): string {
  if (!cap || !Number.isFinite(cap.value) || cap.value <= 0) return "";
  return currencyValueLabel(cap.value, "USD");
}
// 亿 (1e8) and 万亿 (1e12) are the units Chinese readers expect for CNY values.
export function cnyLabel(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (locale !== "zh-CN") return compact(value, "¥");
  const [divisor, unit] = value >= 1e12 ? [1e12, "万亿"] : value >= 1e8 ? [1e8, "亿"] : [1e4, "万"];
  return "¥" + new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / divisor) + unit;
}
export function marketCapDescription(cap: GraphMarketCap | undefined, locale: string): string {
  if (!marketCapLabel(cap)) return "";
  const zh = locale === "zh-CN";
  const local = cap!.local && cnyLabel(cap!.local.value, locale);
  const amount = local ? `${local} CNY (≈ ${marketCapLabel(cap)} USD)` : `${marketCapLabel(cap)} USD`;
  return (zh ? "估算市值" : "Estimated market cap") + ": " + amount + " · " + (zh ? "截至" : "As of") + " " + cap!.priceDate;
}
