import { headers } from "next/headers";
import { researchCompanies, researchConnections, RESEARCH_PATH, REVIEWED } from "@/lib/research/amd-ecosystem";
import styles from "./research-discovery.module.css";

export async function ResearchDiscovery() {
  const zh = (await headers()).get("x-ya-language") === "zh-CN";
  const lang = zh ? "zh" : "en", prefix = zh ? "/zh-cn" : "/en";
  return <section className={styles.section} aria-labelledby="research-discovery"><h2 id="research-discovery">{zh ? "从一条有依据的关系开始研究" : "Start with a connection you can verify"}</h2>
    <p>{zh ? "AMD 生态：区分 CPU 云端采用、GPU 产品集成与机架计划。" : "AMD’s ecosystem: separate CPU cloud adoption, GPU product integration and rack plans."} <a href={`${prefix}${RESEARCH_PATH}`}>{zh ? "阅读研究与证据" : "Read the research and evidence"} →</a></p>
    <div className={styles.grid}>{researchCompanies.map(c=><article className={styles.card} key={c.symbol}><a href={`${prefix}/ticker/${c.symbol}`}><strong>{c.name[lang]} · {c.symbol}</strong></a><p>{c.role[lang]}</p></article>)}</div>
    <p className={styles.muted}>{zh ? "来源示例" : "Evidence highlights"}: {researchConnections.filter(c=>["TSM","MU","AMZN"].includes(c.symbol)).map((c,i)=><span key={c.id}>{i>0?" · ":""}<a href={c.url} target="_blank" rel="noopener noreferrer">{c.label[lang]}</a></span>)}. {zh ? "证据复核" : "Evidence reviewed"}: <time dateTime={REVIEWED}>{REVIEWED}</time>.</p>
  </section>;
}
