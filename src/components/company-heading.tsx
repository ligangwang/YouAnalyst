"use client";
import { companyName } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";
export function CompanyHeading({name, names, ticker}: {name: string; names?: Partial<Record<"en" | "zh-CN", string>>; ticker: string}) {
  const {locale} = useLocale();
  const title = companyName({id:ticker,name,names},locale);
  return <h1 className="mt-2 break-words font-[var(--font-sora)] text-3xl font-semibold leading-tight text-white">{title}{title !== ticker ? ` (${ticker})` : ""}</h1>;
}
