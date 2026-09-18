"use client";
import { companyName } from "@/lib/knowledge-graph/model";
import { CompanyQuote } from "./company-quote";


import { CompanyPosts } from "./company-posts";
import { LocalizedLink as Link } from "./localized-link";
import { CompanyCallActions } from "./company-call-actions";
import { useLocale } from "./providers/locale-provider";
import type { ChinaCompany } from "@/lib/industry-research/china";
import { CompanyResearchPanel } from "./company-research-panel";
import { CompanyProfileDetails } from "./company-profile-details";

export function ChinaCompanyPage({ company }: { company: ChinaCompany }) {
  const { text, locale } = useLocale();
  return <main className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
    <Link href="/companies" className="text-sm text-cyan-200 hover:underline">{text("Search companies", "搜索公司")} →</Link>
    <header className="mt-8 border-b border-white/10 pb-8">
      <p className="text-sm text-cyan-200">{text(company.stageEn || company.stage, company.stage)}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{companyName({...company, names: {...company.names, en: company.names?.en || company.en}}, locale)}</h1>
      {company.listingStatus !== "PRIVATE" && <CompanyQuote ticker={company.id} />}
      <p className="mt-3 text-sm tabular-nums text-slate-400">{company.id.split(":")[1]} · {company.id.startsWith("XSHG:") ? text("Shanghai", "上交所") : text("Shenzhen", "深交所")}</p>

    </header>
    <CompanyResearchPanel companyId={company.id} />
    <CompanyPosts ticker={company.id} />
    <section id="company-information" className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-6 sm:p-8">
      <h2 className="text-lg font-semibold">{text("Company overview", "公司概览")}</h2>
      <p className="mt-4 whitespace-pre-line text-base leading-8 text-slate-300">{text(company.descriptionEn || company.description, company.description)}</p>
      <h2 className="mt-8 text-lg font-semibold">{text("Sources", "资料来源")}</h2>
      <a href={company.source} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm leading-7 text-cyan-200 hover:underline">{text(company.sourceLabelEn || company.sourceLabel, company.sourceLabel)} ↗</a>
    </section>
    <CompanyProfileDetails profile={company.profile} />
      {company.listingStatus !== "PRIVATE" && <CompanyCallActions ticker={company.id} />}
  </main>;
}
