"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/providers/auth-provider";
import { LocaleProvider } from "./locale-provider";
import type { Locale } from "@/lib/locale";
import type { MarketSelection } from "@/lib/preferences";
import { MarketProvider } from "./market-provider";

type AppProvidersProps = {
  children: ReactNode;
  locale?: Locale;
  market?: MarketSelection;
};

export function AppProviders({ children, locale = "en", market = "US" }: AppProvidersProps) {
  return <LocaleProvider locale={locale}><AuthProvider><MarketProvider market={market}>{children}</MarketProvider></AuthProvider></LocaleProvider>;
}
