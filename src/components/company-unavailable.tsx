"use client";

import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";

export function CompanyUnavailable({ label }: { label?: string }) {
  const { text } = useLocale();
  return <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
    <section className="company-profile-header rounded-2xl border p-6 sm:p-10">
      <p className="text-sm font-semibold text-cyan-300">{text("Company research", "公司研究")}</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-50">{text("Company profile not available", "暂无公司资料")}</h1>
      <p className="mt-5 break-words text-base leading-7 text-slate-300">{label
        ? text(`We don’t have a company profile for “${label}” yet.`, `我们暂时没有“${label}”的公司资料。`)
        : text("We don’t have a profile for this company yet.", "我们暂时没有这家公司的资料。")}</p>
      <p className="mt-3 text-sm leading-6 text-slate-400">{text("Our company coverage is growing. Try searching by another name or ticker, or browse the companies already available.", "我们的公司资料覆盖范围正在扩大。您可以尝试其他公司名称或股票代码，或浏览已有的公司资料。")}</p>
      <div className="mt-7 flex flex-wrap gap-4">
        <Link href="/companies" className="rounded-full border border-cyan-400/40 px-5 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10">{text("Search companies", "搜索公司")}</Link>
        <Link href="/" className="rounded-full border border-white/15 px-5 py-2 text-sm text-slate-200 hover:bg-white/10">{text("Explore companies", "探索公司")}</Link>
        <Link href="/feedback" className="self-center text-sm text-cyan-200 underline underline-offset-4">{text("Suggest a company", "建议添加公司")}</Link>
      </div>
    </section>
  </main>;
}
