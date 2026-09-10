"use client";

import { useLocale } from "./providers/locale-provider";
import { translateUi } from "@/lib/i18n/translate";
import type { ReactNode } from "react";

/** Only authored UI text belongs here; never pass user posts or source excerpts. */
export function UiText({ text }: { text: ReactNode }) {
  const { locale } = useLocale();
  return <>{typeof text === "string" ? translateUi(text, locale) : text}</>;
}
export function useUiText() {
  const { locale } = useLocale();
  return (value: string) => translateUi(value, locale);
}
