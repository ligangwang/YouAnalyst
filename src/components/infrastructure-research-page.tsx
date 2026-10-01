import type { ResearchTopic } from "@/lib/research/infrastructure-topics";
import { RESEARCH_REVIEWED, topicSources } from "@/lib/research/infrastructure-topics";
import { companyLinks } from "@/lib/research/deep-dives";
import { EvidenceLink, ShareResearchView } from "./research-actions";
import { CompanyFollowButton } from "./company-follow-button";
import styles from "./research-discovery.module.css";

export function InfrastructureResearchPage({ topic, chinese = false }: { topic: ResearchTopic; chinese?: boolean }) {
  const lang = chinese ? "zh" : "en", prefix = chinese ? "/zh-cn" : "/en";
  const text = (en: string, zh: string) => chinese ? zh : en;
  return <main className={styles.section}>
    <a href={`${prefix}/research`}>← {text("Research deep-dives", "研究专题")}</a>
    <h1>{topic.title[lang]}</h1>
    <p>{topic.summary[lang]}</p>
    <p className={styles.muted}>{text("Evidence reviewed", "证据复核")}: <time dateTime={RESEARCH_REVIEWED}>{RESEARCH_REVIEWED}</time> · {text("Statements below retain the dates and scope of their sources.", "以下陈述保留原始来源的日期与范围。")}</p>
    <p>{topic.framing[lang]}</p>
    <div className={styles.actions}><a href={`${prefix}/feed?scope=following`}>{text("Follow companies and track sourced updates", "关注公司，追踪有来源的更新")}</a><ShareResearchView /></div>
    <section aria-label={topic.diagramTitle[lang]}>
      <h2>{topic.diagramTitle[lang]}</h2>
      <ol className={`${styles.grid} ${styles.flow}`}>{topic.steps.map(step => <li className={styles.card} key={step.title.en}><strong>{step.title[lang]}</strong><p>{step.detail[lang]}</p></li>)}</ol>
      <p className={styles.muted}>{topic.diagramNote[lang]}</p>
    </section>
    <h2>{text("Companies, evidence and limits", "公司、证据与边界")}</h2>
    <div className={styles.dives}>{topic.evidence.map(row => {
      const source = topicSources[row.source];
      const links = row.companyId ? companyLinks(row.companyId, prefix) : null;
      return <article className={styles.dive} id={row.id} key={row.id}>
        <h3>{row.title[lang]}</h3><span className={styles.badge}>{row.status[lang]}</span>
        <p>{row.finding[lang]}</p>
        <p><strong>{text("Evidence limit: ", "证据边界：")}</strong>{row.limit[lang]}</p>
        <p><strong>{text("What to check next: ", "下一步核查：")}</strong>{row.next[lang]}</p>
        <p className={styles.muted}>{text("Source published", "资料发布日期")}: <time dateTime={source.published}>{source.published}</time><br/><EvidenceLink href={source.url} entryPoint={topic.slug} ticker={row.ticker ?? ""}>{source.title}</EvidenceLink></p>
        {links && <div className={styles.actions}><a href={links.page}>{text("Research company", "研究公司")}</a><a href={links.map}>{text("Open in map", "在图谱中打开")}</a><CompanyFollowButton companyId={row.companyId!} /></div>}
      </article>;
    })}</div>
    <h2>{text("Continue the research", "继续研究")}</h2>
    <ul>{topic.nextSteps.map(step => <li key={step.en}>{step[lang]}</li>)}</ul>
    <div className={styles.actions}><a href={`${prefix}/research/nvidia-ai-ecosystem?layer=chips#connections`}>{text("NVIDIA supplier evidence", "英伟达供应商证据")}</a><a href={`${prefix}/research/${topic.slug === "hbm-supply" ? "ai-infrastructure-bottlenecks" : "hbm-supply"}`}>{topic.slug === "hbm-supply" ? text("Explore cooling and infrastructure dependencies", "研究散热与基础设施依赖") : text("Compare HBM evidence", "比较 HBM 证据")}</a></div>
  </main>;
}
