import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { localizedMetadata } from "@/lib/ui/i18n/server";

const contactEmail = "support@youanalyst.com";
const xHandle = "knoics321";

export async function generateMetadata(): Promise<Metadata> {
  const chinese = (await headers()).get("x-ya-language") === "zh-CN";
  return localizedMetadata({
    title: chinese ? "关于我们 | YouAnalyst" : "About us | YouAnalyst",
    description: chinese
      ? "了解 YouAnalyst：探索公司关系、核查来源、对比股票表现，并与社区分享研究。"
      : "Meet YouAnalyst: explore company connections, check sources, compare stock performance, and share research with the community.",
    alternates: { canonical: "/about" },
  });
}

export default async function AboutPage() {
  const chinese = (await headers()).get("x-ya-language") === "zh-CN";
  const prefix = chinese ? "/zh-cn" : "/en";
  const text = (en: string, zh: string) => chinese ? zh : en;
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <header className="border-b border-white/10 pb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">{text("About us", "关于我们")}</p>
        <h1 className="mt-3 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">{text("Understand the companies behind your investments.", "了解你所投资的公司。")}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-200">{text(
          "YouAnalyst connects company relationships, market developments, and source documents to help investors see the bigger picture. Explore suppliers, customers, and partners; compare stock performance; and share research with a community of investors.",
          "YouAnalyst 将公司关系、市场动态与来源文档连接起来，帮助投资者看清全局。探索供应商、客户与合作伙伴，对比股票表现，并与投资者社区分享研究。",
        )}</p>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">{text(
          "We’re starting with AI, robotics, and space, with plans to expand into more industries. Across every sector, we combine AI-assisted research, transparent sources, and a track record of published views.",
          "我们从人工智能、机器人与航天领域起步，计划逐步拓展至更多行业。在每个行业，我们都将 AI 辅助研究、透明可查的来源与已发表观点的历史表现记录结合起来。",
        )}</p>
      </header>

      <section aria-labelledby="about-product" className="border-b border-white/10 py-8">
        <h2 id="about-product" className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">{text("What you can do here", "你可以在这里做什么")}</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div><h3 className="font-semibold text-slate-100">{text("Explore connected companies", "探索公司之间的联系")}</h3><p className="mt-2 text-sm leading-7 text-slate-400">{text("Discover suppliers, customers, and partners. Open a relationship to inspect its sources and follow the latest recorded developments.", "发现供应商、客户与合作伙伴，查看关系的来源，并追踪最新收录的动态。")}</p></div>
          <div><h3 className="font-semibold text-slate-100">{text("Compare and share", "对比与分享")}</h3><p className="mt-2 text-sm leading-7 text-slate-400">{text("Compare stock performance over the same dates, customize company colors, and publish a replay for the community to discuss.", "在相同日期范围内对比股票表现，自定义公司颜色，并发布回放供社区交流讨论。")}</p></div>
          <div><h3 className="font-semibold text-slate-100">{text("Build a research record", "积累研究记录")}</h3><p className="mt-2 text-sm leading-7 text-slate-400">{text("Save companies to your watchlist, publish views with supporting evidence, and keep your comparisons and track record on your profile.", "将公司加入自选股，发布附有依据的观点，并在个人主页保存对比和历史表现。")}</p></div>
          <div><h3 className="font-semibold text-slate-100">{text("Check the evidence", "核查依据")}</h3><p className="mt-2 text-sm leading-7 text-slate-400">{text("We use AI-assisted research and source links to help organize information. Coverage is incomplete, and AI can make mistakes. Check the original documents before relying on a claim.", "我们利用 AI 辅助研究和来源链接来整理信息。覆盖范围并不完整，AI 也可能出错。请在采信信息前核查原始文档。")}</p></div>
        </div>
        <div className="mt-6 flex flex-wrap gap-5 text-sm font-medium text-cyan-200">
          <Link href={`${prefix}?view=graph`} className="underline-offset-4 hover:underline">{text("Explore companies →", "探索公司 →")}</Link>
          <Link href={`${prefix}/compare`} className="underline-offset-4 hover:underline">{text("Compare stocks →", "对比股票 →")}</Link>
        </div>
      </section>

      <section aria-labelledby="about-contact" className="py-8">
        <h2 id="about-contact" className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">{text("Contact us", "联系我们")}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">{text("Have a question, a suggestion, or a partnership idea? We’d like to hear from you.", "有问题、建议或合作想法？欢迎联系我们。")}</p>
        <dl className="mt-5 grid gap-4 text-sm">
          <div>
            <dt className="font-medium text-slate-200">{text("Email", "电子邮箱")}</dt>
            <dd className="mt-1"><a href={`mailto:${contactEmail}`} className="break-all text-cyan-200 underline-offset-4 hover:underline">{contactEmail}</a></dd>
          </div>
          <div>
            <dt className="font-medium text-slate-200">X</dt>
            <dd className="mt-1"><a href={`https://x.com/${xHandle}`} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline-offset-4 hover:underline">@{xHandle}</a></dd>
          </div>
        </dl>
        <Link href={`${prefix}/feedback`} className="mt-5 inline-block rounded-lg border border-cyan-400/30 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-400/10">{text("Send feedback", "发送反馈")}</Link>
      </section>
    </main>
  );
}
