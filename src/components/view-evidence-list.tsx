"use client";

import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import type { ViewEvidence } from "@/lib/posts/evidence";

/** The research a view cites. Earlier views without citations render nothing. */
export function ViewEvidenceList({ evidence, compact = false }: { evidence?: ViewEvidence[] | null; compact?: boolean }) {
  const { text, locale } = useLocale();
  const items = Array.isArray(evidence) ? evidence.filter(item => item && typeof item.href === "string" && item.label) : [];
  if (!items.length) return null;
  const label = (item: ViewEvidence) => (locale === "zh-CN" ? item.label["zh-CN"] : item.label.en) || item.label.en;
  return <section aria-label={text("Cited evidence", "引用依据")} className={compact ? "mt-2" : "mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"}>
    {!compact && <h3 className="mb-2 text-sm font-semibold text-slate-200">{text("Cited evidence", "引用依据")}</h3>}
    <ul className={compact ? "flex flex-wrap gap-1.5" : "grid gap-1.5"}>
      {items.map(item => <li key={`${item.kind}:${item.id}`}>
        <Link href={item.href} className={compact ? "inline-flex rounded-full border border-cyan-300/30 px-2 py-0.5 text-xs text-cyan-100 hover:bg-cyan-400/10" : "text-sm text-cyan-200 hover:underline"}>
          {!compact && <span className="mr-1.5 text-xs uppercase tracking-wide text-slate-500">{item.kind === "relationship" ? text("Relationship", "关系") : text("Research", "研究")}</span>}
          {label(item)}
        </Link>
      </li>)}
    </ul>
  </section>;
}
