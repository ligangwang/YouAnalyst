"use client";
import Link from "next/link";
import { useLocale } from "./providers/locale-provider";

export function RetiredCompanyResearch() {
  const { text } = useLocale();
  return <main className="mx-auto max-w-3xl px-4 py-8">
    <h1 className="text-2xl font-semibold">{text("AI company and industry research retired", "AI 公司与行业研究已停用")}</h1>
    <p className="my-4">{text("US and A-share research jobs are no longer available. Existing published company profiles and relationships remain available.", "美股与 A 股研究任务已停用。已有的已发布公司资料与关系仍可查看。")}</p>
    <Link href="/admin/jobs" className="underline">{text("Company directory imports and job history", "公司目录导入与任务历史")}</Link>
  </main>;
}
