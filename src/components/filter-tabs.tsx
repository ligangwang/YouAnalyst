import Link from "next/link";
import styles from "./filter-tabs.module.css";

/** URL-backed filters remain shareable and usable without client JavaScript. */
export function FilterTabs({ label, items }: { label: string; items: readonly { label: string; href: string; active: boolean }[] }) {
  return <nav aria-label={label} className={styles.tabs}>{items.map(item =>
    <Link key={item.href} href={item.href} scroll={false} prefetch={false} aria-current={item.active ? "page" : undefined}>{item.label}</Link>
  )}</nav>;
}
