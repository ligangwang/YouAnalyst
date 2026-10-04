import { headers } from "next/headers";
import { localizedMetadata } from "@/lib/i18n/server";
import { companyLinks, deepDives } from "@/lib/research/deep-dives";
import { infrastructureTopics, RESEARCH_REVIEWED } from "@/lib/research/infrastructure-topics";
import styles from "@/components/research-discovery.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const zh = (await headers()).get("x-ya-language") === "zh-CN";
  return localizedMetadata({ title: zh ? "AI 生态研究专题：供应链来源资料 | YouAnalyst" : "AI ecosystem research deep-dives: sourced supply-chain sources | YouAnalyst", description: zh ? "逐条引用原始来源的 AI 公司生态研究，区分已出货与已宣布的计划。" : "Research deep-dives on AI companies’ ecosystems. Every connection cites a primary source, and shipped products are kept separate from announced plans." });
}
export default async function ResearchIndex() {
  const zh = (await headers()).get("x-ya-language") === "zh-CN", lang = zh ? "zh" : "en", prefix = zh ? "/zh-cn" : "/en";
  return <main className={styles.section}>
    <a href={prefix}>{zh ? "AI 产业图谱" : "AI industry map"} ←</a>
    <h1>{zh ? "研究专题" : "Research deep-dives"}</h1>
    <p>{zh ? "每个专题选取一家公司的生态，列出供应商、客户与合作伙伴的原始证据，并说明每条证据未能证明什么。来源日期与复核日期分别列示。" : "Each deep-dive takes one company’s ecosystem and lists primary evidence for its suppliers, customers and partners, including what each source does not establish. Source dates are shown separately from review dates."}</p>
    <h2>{zh ? "按研究问题开始" : "Start with a research question"}</h2>
    <div className={styles.dives}>{infrastructureTopics.map(topic => <article className={styles.dive} key={topic.slug}>
      <h2><a href={`${prefix}/research/${topic.slug}`}>{topic.title[lang]}</a></h2>
      <p>{topic.summary[lang]}</p>
      <p className={styles.muted}>{zh ? "来源复核" : "Sources reviewed"}: <time dateTime={RESEARCH_REVIEWED}>{RESEARCH_REVIEWED}</time></p>
      <a href={`${prefix}/research/${topic.slug}`}>{zh ? "核查公司、来源与边界" : "Check the companies, sources and limits"} →</a>
    </article>)}</div>
    <h2>{zh ? "公司生态研究" : "Company ecosystems"}</h2>
    <div className={styles.dives}>{deepDives.map(d => <article className={styles.dive} key={d.slug}>
      <h2><a href={`${prefix}${d.path}`}>{d.title[lang]}</a></h2>
      <p>{d.summary[lang]}</p>
      <ul className={styles.chips}>{d.companies.map(c => { const links = companyLinks(c.id, prefix); return <li key={c.id}>{links ? <a href={links.page} title={c.role[lang]}>{c.name[lang]}</a> : <span title={c.role[lang]}>{c.name[lang]}</span>}</li>; })}</ul>
      <p className={styles.muted}>{zh ? "来源复核" : "Sources reviewed"}: <time dateTime={d.reviewed}>{d.reviewed}</time></p>
      <a href={`${prefix}${d.path}`}>{zh ? "阅读研究与来源" : "Read the research and sources"} →</a>
    </article>)}</div>
  </main>;
}
