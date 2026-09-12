"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useLocale } from "./providers/locale-provider";
import { isLocalizedPage, localizedPath, unlocalizedPath } from "@/lib/i18n/urls";

export function LocalizedLink({ href, ...props }: ComponentProps<typeof Link>) {
  const { locale } = useLocale();
  if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
    const url = new URL(href, "https://youanalyst.com");
    const path = unlocalizedPath(url.pathname);
    if (isLocalizedPage(path)) href = localizedPath(path === "/map" && url.searchParams.get("view") !== "filings" ? "/" : path, locale) + url.search + url.hash;
  }
  return <Link {...props} href={href} />;
}
