"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pathLocale, unlocalizedPath } from "@/lib/i18n/urls";
import { parseMarket } from "@/lib/preferences";
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
  const pathname = usePathname();
  const params = useSearchParams();
  const currentLocale = pathLocale(pathname) ?? locale;
  const currentMarket = parseMarket(params.get("market")) ?? (unlocalizedPath(pathname) === "/" ? "ALL" : market);
  useEffect(() => { document.documentElement.lang = currentLocale; }, [currentLocale]);
  return <LocaleProvider locale={currentLocale}><AuthProvider><MarketProvider market={currentMarket}>{children}</MarketProvider></AuthProvider></LocaleProvider>;
}
