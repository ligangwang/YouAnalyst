"use client";
import { languageUrl } from "@/lib/ui/i18n/urls";
import { createContext, useContext } from "react";
import type { DisplayPreferences, MarketSelection, PriceColorConvention, UiTheme, ThemeMode } from "@/lib/preferences";
export type MarketContextValue = { active: boolean; market: MarketSelection; priceColors: PriceColorConvention; theme: UiTheme; themeMode: ThemeMode; changeTheme: (mode: ThemeMode) => void; saving: boolean; error: boolean; change: (preferences: DisplayPreferences) => Promise<void> };
export function applyPreferences(preferences: DisplayPreferences, navigate: (url: string) => void = url => window.location.assign(url)) {
  const url = languageUrl(new URL(window.location.href), preferences.language);
  url.searchParams.delete("market");
  navigate(url.toString());
}
export const MarketContext = createContext<MarketContextValue>({ active: false, market: "ALL", priceColors: "green-up", theme: "dark", themeMode: "system", changeTheme: () => {}, saving: false, error: false, change: async preferences => applyPreferences(preferences) });
export function useMarket() { return useContext(MarketContext); }
