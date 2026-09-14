"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { pathLocale } from "@/lib/i18n/urls";
import { AuthProvider } from "@/components/providers/auth-provider";
import { LocaleProvider } from "./locale-provider";
import type { Locale } from "@/lib/locale";
import { MarketProvider } from "./market-provider";

type AppProvidersProps = {
  children: ReactNode;
  locale?: Locale;
};

export function AppProviders({ children, locale = "en" }: AppProvidersProps) {
  const pathname = usePathname();
  const currentLocale = pathLocale(pathname) ?? locale;
  useEffect(() => { document.documentElement.lang = currentLocale; }, [currentLocale]);
  return <LocaleProvider locale={currentLocale}><AuthProvider><MarketProvider>{children}</MarketProvider></AuthProvider></LocaleProvider>;
}
