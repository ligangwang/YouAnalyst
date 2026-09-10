"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/providers/auth-provider";
import { LocaleProvider } from "./locale-provider";
import type { Locale } from "@/lib/locale";

type AppProvidersProps = {
  children: ReactNode;
  locale?: Locale;
};

export function AppProviders({ children, locale = "en" }: AppProvidersProps) {
  return <LocaleProvider locale={locale}><AuthProvider>{children}</AuthProvider></LocaleProvider>;
}
