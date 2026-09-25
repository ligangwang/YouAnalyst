"use client";
import type { GraphPrivateValuation } from "@/lib/knowledge-graph/model";
import { currencyValueLabel } from "@/lib/knowledge-graph/market-cap";
import { useLocale } from "./providers/locale-provider";

export function PrivateValuationDisplay({ valuation, compact = false }: { valuation: GraphPrivateValuation; compact?: boolean }) {
  const { text } = useLocale();
  const amount = (valuation.qualifier === "greater_than" ? "> " : "") + currencyValueLabel(valuation.value, valuation.currency);
  const basis = text("Private valuation · post-money", "私人公司估值 · 投后估值");
  const date = `${valuation.currency === "USD" ? text("USD", "美元") : text("EUR", "欧元")} · ${text("As of", "截至")} ${valuation.valuationDate}`;
  const review = valuation.verification === "reviewed"
    ? `${text("Reviewed", "已审核")} ${valuation.reviewedAt} · ${text("Automated recheck unavailable", "自动复核暂不可用")}`
    : valuation.reviewPending ? text("New source review pending", "新来源待审核") : "";
  if (compact) return <span data-private-valuation>
    <a href={valuation.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", fontWeight: "inherit" }}
      title={[basis, review, text("View source", "查看来源")].filter(Boolean).join(" · ")}
      aria-label={[basis, amount, date, review, text("View source", "查看来源")].filter(Boolean).join(" · ")}>{amount}</a>
    <small>{date}</small>
  </span>;
  return <span data-private-valuation>
    <span>{amount}</span>
    <small style={{ display: "block" }}>{basis}</small>
    <small style={{ display: "block" }}>{date} · <a href={valuation.sourceUrl} target="_blank" rel="noopener noreferrer">{text("Source", "来源")}</a></small>
    {review && <small style={{ display: "block" }}>{review}</small>}
  </span>;
}
