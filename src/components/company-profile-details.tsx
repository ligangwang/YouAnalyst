"use client";

import type { CompanyProfile } from "@/lib/company-profile";
import { useLocale } from "./providers/locale-provider";

export function CompanyProfileDetails({ profile }: { profile: CompanyProfile | null | undefined }) {
  const { text } = useLocale();
  if (!profile) return null;
  const report = profile.financialReport;
  return <section className="my-8 rounded-2xl border border-white/10 bg-white/[0.025] p-6" aria-label={text("Company information", "公司资料")}>
    <dl className="flex flex-wrap gap-x-10 gap-y-5 text-sm">
      {profile.location && <div className="max-w-xl"><dt className="text-slate-400">{profile.location.kind === "HEADQUARTERS" ? text("Headquarters", "总部") : profile.location.kind === "OFFICE" ? text("Office address", "办公地址") : text("Business address", "营业地址")}</dt><dd className="mt-2 text-slate-200"><a href={profile.location.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-200">{profile.location.label} ↗</a></dd></div>}
      {([ [profile.website, text("Website", "公司官网")], [profile.investorRelations, text("Investor relations", "投资者关系")], [profile.disclosures, text("Filings", "公告披露")] ] as const).map(([link, label]) => link && <div key={label}><dt className="text-slate-400">{label}</dt><dd className="mt-2"><a className="text-cyan-200 hover:underline" href={link.url} target="_blank" rel="noopener noreferrer">{text("Visit", "查看")} ↗</a></dd></div>)}
    </dl>
    <h2 className="mt-6 text-lg font-semibold text-slate-100">{text("Latest financial report", "最新财务报告")}</h2>
    {report ? <><a className="mt-3 inline-block text-cyan-200 hover:underline" href={report.url} target="_blank" rel="noopener noreferrer">{report.title} ↗</a><p className="mt-2 text-sm text-slate-400">{text("Period ended", "报告期末")} {report.periodEnd} · {text("Published", "披露日期")} {report.publishedAt}</p></> : <p className="mt-3 text-sm text-slate-400">{profile.financialReportStatus === "NOT_FOUND" ? text("No public financial report found in the checked sources.", "已核查来源中未找到公开财务报告。") : text("Latest financial report has not yet been verified.", "最新财务报告尚待核实。")}</p>}
    {profile.financialReportCheckedSources?.length ? <details className="mt-3 text-sm text-slate-400"><summary className="cursor-pointer">{text("Checked sources", "已核查来源")}</summary><ul className="mt-2 space-y-2">{profile.financialReportCheckedSources.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-cyan-200">{new URL(url).hostname} ↗</a></li>)}</ul></details> : null}
    <p className="mt-4 text-xs text-slate-500">{text("Sources checked", "来源核查于")} {profile.checkedAt}</p>
  </section>;
}
