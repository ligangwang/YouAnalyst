"use client";
import { createContext, useContext } from "react";
import type { DisplayPreferences, MarketSelection } from "@/lib/preferences";
export type MarketContextValue = { active: boolean; market: MarketSelection; saving: boolean; error: boolean; change: (preferences: DisplayPreferences) => Promise<void> };
export function applyPreferences(preferences: DisplayPreferences) {
  const url = new URL(window.location.href);
  url.searchParams.set("lang", preferences.language);
  url.searchParams.set("market", preferences.market);
  window.location.assign(url);
}
export const MarketContext = createContext<MarketContextValue>({ active: false, market: "US", saving: false, error: false, change: async preferences => applyPreferences(preferences) });
export function useMarket() { return useContext(MarketContext); }
