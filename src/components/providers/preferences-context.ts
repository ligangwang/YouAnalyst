"use client";
import { pathLocale, languageUrl } from "@/lib/i18n/urls";
import { createContext, useContext } from "react";
import type { DisplayPreferences, MarketSelection } from "@/lib/preferences";
export type MarketContextValue = { active: boolean; market: MarketSelection; saving: boolean; error: boolean; change: (preferences: DisplayPreferences) => Promise<void> };
export function applyPreferences(preferences: DisplayPreferences, navigate: (url: string) => void = url => window.location.assign(url)) {
  const url = languageUrl(new URL(window.location.href), preferences.language);
  if (url.searchParams.get("market") !== "NONE" || pathLocale(window.location.pathname) === preferences.language) url.searchParams.set("market", preferences.market);
  navigate(url.toString());
}
export const MarketContext = createContext<MarketContextValue>({ active: false, market: "US", saving: false, error: false, change: async preferences => applyPreferences(preferences) });
export function useMarket() { return useContext(MarketContext); }
