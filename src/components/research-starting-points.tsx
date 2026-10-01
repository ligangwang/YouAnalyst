"use client";

import { trackEvent } from "@/lib/analytics";
import type { ResearchStartingPoint } from "@/lib/research/starting-points";
import { LocalizedLink } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import styles from "./research-starting-points.module.css";

export function ResearchStartingPoints({ entries }: { entries: ResearchStartingPoint[] }) {
  const { text, chinese } = useLocale();
  const language = chinese ? "zh" : "en";
  return <section className={styles.section} aria-label={text("Start your investment research", "开始投资研究")}>
    <p className={styles.benefit}>{text("Find the companies behind AI and check the evidence behind your investment thesis.", "沿 AI 产业链找到关键公司，用原始证据检验投资判断。")}</p>
    <div className={styles.entries}>{entries.map(entry => <article className={styles.entry} key={entry.id}>
      <h2><LocalizedLink href={entry.href} onClick={() => trackEvent("graph_discovery_open", { question_id: entry.id, entry_point: "homepage_research" })}>{entry.question[language]} <span aria-hidden="true">→</span></LocalizedLink></h2>
      <p>{entry.summary[language]}</p>
      <ul className={styles.sources} aria-label={text("Primary sources", "原始来源")}>{entry.sources.map(source => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("graph_source_open", { question_id: entry.id, entry_point: "homepage_research" })}>{source.label[language]} <span aria-hidden="true">↗</span></a>
        {source.date && <> · <time dateTime={source.date}>{source.date}</time></>}
      </li>)}</ul>
    </article>)}</div>
  </section>;
}
