import { headers } from "next/headers";
import { companyLinks, deepDives } from "@/lib/research/deep-dives";
import styles from "./research-discovery.module.css";

export async function ResearchDiscovery() {
  const zh = (await headers()).get("x-ya-language") === "zh-CN";
  const lang = zh ? "zh" : "en", prefix = zh ? "/zh-cn" : "/en";
  return <section className={styles.section} aria-labelledby="research-discovery"><h2 id="research-discovery">{zh ? "从一条有依据的关系开始研究" : "Start with a connection you can verify"}</h2>
    <p>{zh ? "研究专题逐条列出原始来源，并区分已出货与已宣布的计划。" : "Each deep-dive cites primary sources and separates what has shipped from what is only announced."} <a href={`${prefix}/research`}>{zh ? "全部研究专题" : "All research deep-dives"} →</a></p>
    <div className={styles.dives}>{deepDives.map(d => <article className={styles.dive} key={d.slug}>
      <h3><a href={`${prefix}${d.path}`}>{d.title[lang]}</a></h3>
      <p>{d.summary[lang]}</p>
      <ul className={styles.chips}>{d.companies.map(c => { const links = companyLinks(c.id, prefix); return <li key={c.id}>{links ? <a href={links.page} title={c.role[lang]}>{c.name[lang]}</a> : <span title={c.role[lang]}>{c.name[lang]}</span>}</li>; })}</ul>
      <p className={styles.muted}>{zh ? "来源示例" : "Evidence highlights"}: {d.highlights.map((c,i)=><span key={c.id}>{i>0?" · ":""}<a href={c.url} target="_blank" rel="noopener noreferrer">{c.label[lang]}</a></span>)}. {zh ? "证据复核" : "Evidence reviewed"}: <time dateTime={d.reviewed}>{d.reviewed}</time>.</p>
      <a href={`${prefix}${d.path}`}>{zh ? "阅读研究与证据" : "Read the research and evidence"} →</a>
    </article>)}</div>
  </section>;
}
