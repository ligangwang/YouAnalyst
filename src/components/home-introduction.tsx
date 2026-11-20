"use client";

import { CompanySearch } from "./company-search";
import { LocalizedLink } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import styles from "./home-introduction.module.css";

export function HomeIntroduction() {
  const { text } = useLocale();
  return (
    <main className={styles.home} data-testid="home-introduction">
      <h1>{text("Start with a company.", "从一家公司开始。")}</h1>
      <p>{text(
        "Explore its business, follow the evidence, and build your investment view.",
        "了解公司业务，追踪研究依据，形成你的投资观点。",
      )}</p>
      <div className={styles.actions}>
        <CompanySearch owner="directory" typeToSearch={false} />
        <LocalizedLink href="/?view=graph" prefetch={false}>
          {text("Explore the company map", "探索公司关系图")}
          <span aria-hidden="true">↗</span>
        </LocalizedLink>
      </div>
      <LocalizedLink href="/about" prefetch={false} className={styles.about}>
        {text("About YouAnalyst", "关于 YouAnalyst")}
      </LocalizedLink>
    </main>
  );
}
