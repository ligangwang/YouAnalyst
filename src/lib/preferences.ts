import { parseLocale, type Locale } from "./locale";
export type MarketSelection = "US" | "CN_A" | "ALL";
export type DisplayPreferences = { language: Locale; market: MarketSelection };
export function parseMarket(value: unknown): MarketSelection | null {
  return value === "US" || value === "CN_A" || value === "ALL" ? value : null;
}
export function parsePreferences(value: unknown): DisplayPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const language = parseLocale(candidate.language);
  const market = parseMarket(candidate.market);
  return language && market ? { language, market } : null;
}
