"use client";
import type { GraphPrivateValuation } from "@/lib/knowledge-graph/model";
import { useLocale } from "./providers/locale-provider";

export function PrivateValuationDisplay({ valuation }: { valuation: GraphPrivateValuation }) {
  const { locale, text } = useLocale();
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency: valuation.currency, currencyDisplay: "code", notation: "compact", maximumFractionDigits: 2 }).format(valuation.value);
  return <span data-private-valuation>
    <strong>{valuation.qualifier === "greater_than" ? "> " : ""}{amount}</strong>
    <small style={{ display: "block" }}>{text("Private valuation · post-money", "私人公司估值 · 投后估值")}</small>
    <small style={{ display: "block" }}>{text("As of", "截至")} {valuation.valuationDate} · <a href={valuation.sourceUrl} target="_blank" rel="noopener noreferrer">{text("Source", "来源")}</a></small>
    {valuation.verification === "reviewed" && <small style={{ display: "block" }}>{text("Reviewed", "已审核")} {valuation.reviewedAt} · {text("Automated recheck unavailable", "自动复核暂不可用")}</small>}
    {valuation.reviewPending && valuation.verification !== "reviewed" && <small style={{ display: "block" }}>{text("New source review pending", "新来源待审核")}</small>}
  </span>;
}
