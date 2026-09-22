import type { GraphMarketCap } from "./model";
// Area follows value between readability limits. Unknown values retain default size.
export function marketCapScale(cap?: GraphMarketCap): number {
  return cap && Number.isFinite(cap.value) && cap.value > 0
    ? Math.max(.65, Math.min(2.5, Math.sqrt(cap.value / 100_000_000_000))) : 1;
}
export function marketCapLabel(cap?: GraphMarketCap): string {
  if (!cap || !Number.isFinite(cap.value) || cap.value <= 0) return "";
  const unit = cap.value >= 1e12 ? [1e12, "T"] as const : cap.value >= 1e9 ? [1e9, "B"] as const : [1e6, "M"] as const;
  return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(cap.value / unit[0]) + unit[1];
}
export function marketCapDescription(cap: GraphMarketCap | undefined, locale: string): string {
  return marketCapLabel(cap) ? (locale === "zh-CN" ? "估算市值" : "Estimated market cap") + ": " + marketCapLabel(cap) + " USD · " + (locale === "zh-CN" ? "截至" : "As of") + " " + cap!.priceDate : "";
}
