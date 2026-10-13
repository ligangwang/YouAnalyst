"use client";

import { useLocale } from "./providers/locale-provider";
import { CompanyFollowButton } from "./company-follow-button";
import { CompanyCountryFlag } from "./company-country-flag";
import { companyName, companySummary, type GraphNode } from "@/lib/knowledge-graph/model";
import { companyPageUrl } from "@/lib/market-companies/routes";
import { marketCapDescription } from "@/lib/knowledge-graph/market-cap";
import styles from "./company-timeline.module.css";

export function CompanySnapshot({ company, profileLink = true, compact = false, showHeading = true }: { company: GraphNode; profileLink?: boolean; compact?: boolean; showHeading?: boolean }) {
  const { text, locale } = useLocale();
  return <section className={`${styles.snapshot} ${compact ? styles.compact : ""}`} aria-label={text("Company snapshot", "公司快照")}>
    <div>{showHeading && <h2 style={{ margin: 0 }}><CompanyCountryFlag country={company.country} locale={locale} />{companyName(company, locale)}</h2>}
      <p>{company.symbol ?? text("Private / unlisted", "非上市公司")}{company.marketCap && <> · {marketCapDescription(company.marketCap, locale)}</>}</p>
      {!compact && company.summary && <p className={styles.summary}>{companySummary(company, locale)}</p>}</div>
    <div className={styles.snapshotActions}><CompanyFollowButton companyId={company.id} />{profileLink && <a href={companyPageUrl(company.id.startsWith("US:") ? company.id.slice(3) : company.id, company.market)}>{text("Company profile", "公司详情")} →</a>}</div>
  </section>;
}
