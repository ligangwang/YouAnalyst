import { INDUSTRY_SEGMENTS, type IndustryCompany } from "./catalog";

export const MAP_PAGE_SIZE = 20;
export const isMapTicker = (value: unknown): value is string => typeof value === "string" && /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(value);

export function readMapCompany(ticker: string, value: Record<string, unknown>): IndustryCompany | null {
  if (!isMapTicker(ticker) || typeof value.name !== "string" || !value.name.trim()) return null;
  return {
    ticker, name: value.name.trim().slice(0, 160),
    segment: INDUSTRY_SEGMENTS.find((segment) => segment.id === value.segment)?.id ?? "other",
    aliases: Array.isArray(value.aliases) ? value.aliases.filter((name): name is string => typeof name === "string" && name.length <= 160).slice(0, 20) : [],
    ...(value.filingForm === "20-F" ? { filingForm: "20-F" as const } : {}),
    ...(typeof value.expectedCik === "string" && /^\d{10}$/.test(value.expectedCik) ? { expectedCik: value.expectedCik } : {}),
  };
}

export function readMapOptions(params: URLSearchParams) {
  const ticker = (params.get("company") ?? "").trim().replace(/^\$/, "").toUpperCase();
  const after = params.get("after") ?? "";
  if ((ticker && !isMapTicker(ticker)) || (after && !/^[A-Za-z0-9_.-]{1,100}$/.test(after))) throw new Error("Invalid map request");
  return { ticker, after };
}
