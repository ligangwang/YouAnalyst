"use client";

import type { ReactNode } from "react";
import { useLocale } from "./providers/locale-provider";
import styles from "./all-markets-overview.module.css";

export function AllMarketsOverview({ children }: { children: ReactNode }) {
  const { text } = useLocale();
  return <main className={styles.overview}>
    <header className={styles.intro}>
      <h1>{text("Explore markets", "探索市场")}</h1>
      <nav aria-label={text("Market sections", "市场分区")}>
        <a href="#a-share-companies">{text("A-share companies", "A 股公司")} <span aria-hidden="true">↓</span></a>
        <a href="#us-company-connections">{text("US company connections", "美股公司关系")} <span aria-hidden="true">↓</span></a>
      </nav>
    </header>
    {children}
  </main>;
}
