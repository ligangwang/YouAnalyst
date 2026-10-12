import { parseLocale, type Locale } from "./locale";
export type MarketSelection = "US" | "CN_A" | "ALL";
export type PriceColorConvention = "green-up" | "red-up";
export type UiTheme = "dark" | "light";
export type DisplayPreferences = { language: Locale; market: MarketSelection; priceColors?: PriceColorConvention; theme?: UiTheme };
export const DISPLAY_STORAGE_KEY = "youanalyst-display-preferences";
// Only allow known attribute values; this runs before paint, without rendering user text.
export const displayPreferencesBootstrap = `try{var p=JSON.parse(localStorage.getItem('${DISPLAY_STORAGE_KEY}')||'null');if(p){document.documentElement.dataset.theme=p.theme==='light'?'light':'dark';document.documentElement.dataset.priceColors=p.priceColors==='red-up'?'red-up':'green-up'}}catch{}`;
export function parsePriceColors(value: unknown): PriceColorConvention | null {
  return value === "green-up" || value === "red-up" ? value : null;
}
export function parseTheme(value: unknown): UiTheme | null {
  return value === "dark" || value === "light" ? value : null;
}
export function parseMarket(value: unknown): MarketSelection | null {
  return value === "US" || value === "CN_A" || value === "ALL" ? value : null;
}
export function parsePreferences(value: unknown): Required<DisplayPreferences> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const language = parseLocale(candidate.language);
  const market = parseMarket(candidate.market);
  const priceColors = candidate.priceColors === undefined ? "green-up" : parsePriceColors(candidate.priceColors);
  const theme = candidate.theme === undefined ? "dark" : parseTheme(candidate.theme);
  return language && market && priceColors && theme ? { language, market, priceColors, theme } : null;
}
