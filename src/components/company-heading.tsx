"use client";
import { CompanyCountryFlag } from "./company-country-flag";
import { companyName } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";
export function CompanyHeading({name, names, ticker, country}: {name: string; names?: Partial<Record<"en" | "zh-CN", string>>; ticker: string; country?: string | null}) {
  const {locale} = useLocale();
  const title = companyName({id:ticker,name,names},locale);
  return <h1 className="mt-2 break-words font-[var(--font-sora)] text-3xl font-semibold leading-tight text-white"><CompanyCountryFlag country={country} locale={locale} />{title}{title !== ticker ? ` (${ticker})` : ""}</h1>;
}
