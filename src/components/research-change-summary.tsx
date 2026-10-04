"use client";

import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import type { CompanyUpdate } from "@/lib/knowledge-graph/company-updates";
import { researchChangeSummary } from "@/lib/knowledge-graph/change-summary";
import { relationshipExplanation } from "@/lib/knowledge-graph/research-view";
import { trackEvent } from "@/lib/analytics";

export function ResearchChangeSummary({ items, graph, following = false }: { items: CompanyUpdate[]; graph: KnowledgeGraph; following?: boolean }) {
  const { text, chinese, locale } = useLocale();
  const summary = researchChangeSummary(items);
  if (!summary.length) return null;
  const business = summary[0].kind === "BUSINESS";
  return <section aria-label={text("Research summary", "研究摘要")} className="my-6 rounded-2xl border border-cyan-400/25 bg-cyan-950/20 p-5">
    <h2 className="text-lg font-semibold text-cyan-100">{following ? text("What changed for companies you follow?", "关注公司的资料有什么变化？") : text("Start with these developments", "先看这些进展")}</h2>
    <p className="mt-2 text-xs leading-5 text-slate-400">{business ? text("Selected company reports, ordered by event date or source publication date. A report is not proof of a new order, completed delivery or financial impact.", "精选公司披露，按事件日期或资料发布日期排列。披露不代表新订单、已完成交付或财务影响。") : text("Sources added or reviewed. These are research updates; a review date does not establish when the business changed.", "以下为来源收录或复核。研究更新的日期不能用来推断业务发生变化的时间。")}</p>
    <ul className="mt-4 grid gap-4 md:grid-cols-3">
      {summary.map(item => {
        const event = item.business;
        const edge = graph.relationships.find(candidate => candidate.id === item.edgeId);
        const fact = edge?.facts?.find(candidate => candidate.id === item.factId);
        const title = event ? (chinese ? event.titleZh : event.title) : edge ? relationshipExplanation(fact ? { ...edge, facts: [fact] } : edge, graph, chinese) : item.sourceTitle;
        const day = item.sourceDate?.slice(0, 10);
        const companies = item.companyIds.map(id => { const node = graph.nodes.find(n => n.id === id); return node ? companyName(node, locale) : id; }).join(" · ");
        return <li key={item.id} className="min-w-0 rounded-xl border border-cyan-900/50 p-3">
          <p className="text-xs text-slate-400">{companies}</p>
          <p className="mt-1 font-medium"><Link className="text-cyan-100 underline decoration-cyan-800 underline-offset-4" href={item.href} onClick={() => trackEvent("company_event_open", { entry_point: following ? "following_summary" : "public_feed_summary" })}>{title}</Link></p>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-300">{text("Reported change: ", "来源所述进展：")}{event && chinese ? event.summaryZh : item.description}</p>
          <p className="mt-2 text-xs text-amber-100/80">{event?.planned ? text("Announced plan; completed delivery is not established by this item.", "已宣布计划；本条资料未证实已完成交付。") : text("Read the source for its scope; no prior-state comparison is recorded here.", "请核查原文范围；本条未记录可用于前后对比的历史基线。")}</p>
          <p className="mt-2 text-xs text-slate-400">{text("Source published", "资料发布日期")}: {day ? <time dateTime={day}>{day}</time> : text("Not stated", "未注明")}</p>
          {!item.eventDate && <p className="mt-1 text-xs text-slate-400">{text("Event timing is not stated; the source publication date is shown.", "事件发生日期未明确；此处展示来源发布日期。")}</p>}
          <a className="mt-2 inline-block text-xs text-cyan-200 underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("company_evidence_view", { entry_point: "research_summary_source" })}>{text("Read source: ", "查看来源：")}{item.sourceTitle}</a>
        </li>;
      })}
    </ul>
  </section>;
}
