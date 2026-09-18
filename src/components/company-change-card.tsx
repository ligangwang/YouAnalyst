"use client";

import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import type { CompanyUpdate } from "@/lib/knowledge-graph/company-updates";
import type { BusinessEvent } from "@/lib/knowledge-graph/business-events";
import { relationshipExplanation, researchCompanyUrl } from "@/lib/knowledge-graph/research-view";
import { trackEvent } from "@/lib/analytics";
import { InsiderActivitySummary } from "./insider-activity-summary";

export function BusinessEventEvidence({ event }: { event: BusinessEvent }) {
  const { text, chinese } = useLocale();
  return <div className="mt-3 space-y-3 text-sm leading-6">
    <h3 className="font-semibold text-cyan-100">{chinese ? event.titleZh : event.title}</h3>
    {event.planned && <p className="text-amber-200">{text("Announced / planned — not completed delivery", "已宣布／计划中，不代表已交付")}</p>}
    <p>{chinese ? event.summaryZh : event.summary}</p>
    <p className="text-xs text-slate-400">{text("Event / announcement", "事件／宣布日期")}: {event.eventDate ?? text("Not specified", "未明确")} · {text("Source published", "资料发布日期")}: {event.sourceDate} · {text("Collected", "收录日期")}: {event.collectedAt}</p>
    <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("company_evidence_view", {entry_point:"event_source"})} className="text-cyan-200 underline">{event.sourceTitle} ↗</a>
  </div>;
}

export function CompanyChangeCard({ item, graph, publicFeed = false }: { item: CompanyUpdate; graph: KnowledgeGraph; publicFeed?: boolean }) {
  const { text, chinese, locale } = useLocale();
  const name = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n ? companyName(n, locale) : id; };
  const event = item.business;
  const category = event ? ({ ORDER: ["Order", "订单"], CAPACITY: ["Capacity", "扩产"], PRODUCT: ["Product progress", "产品进展"], PARTNERSHIP: ["Partnership change", "合作变更"] } as const)[event.category] : item.kind === "RESEARCH" ? ["Evidence added / reviewed", "证据收录／复核"] : ["SEC disclosure", "SEC 披露"];
  const edge = graph.relationships.find(e => e.id === item.edgeId);
  const fact = edge?.facts?.find(f => f.id === item.factId);
  const title = event ? (chinese ? event.titleZh : event.title) : edge ? relationshipExplanation(fact ? {...edge, facts:[fact]} : edge, graph, chinese) : item.sourceTitle;
  const historical = item.eventDate && item.collectedAt.slice(0,10) > item.eventDate.slice(0,10);
  return <article className="rounded-xl border border-white/10 p-5">
    <p className="text-xs text-cyan-200">{text(category[0], category[1])}{event?.planned && ` · ${text("Planned", "计划中")}`}</p>
    <h3 className="mt-2 font-semibold"><Link href={item.href} onClick={() => { trackEvent("company_event_open", {entry_point:publicFeed ? "public_feed" : "following"}); if (event) trackEvent("company_event_map", {entry_point:publicFeed ? "public_feed" : "following"}); }} className="hover:text-cyan-200">{title}</Link></h3>
    <p className="mt-2 text-sm leading-6 text-slate-300">{event && chinese ? event.summaryZh : item.description}</p>
    {!publicFeed && <ul className="mt-3 space-y-1 border-l-2 border-cyan-800 pl-3 text-xs text-slate-300" aria-label={text("Why this appears", "为何关联到你")}>
      {item.reasons?.map(r => <li key={`${r.followedId}:${r.companyId}:${r.edgeId ?? "direct"}`}>{r.edgeId ? <>{text(`Because ${name(r.companyId)} is a recorded ${r.role} of ${name(r.followedId)}, which you follow.`, `你关注的 ${name(r.followedId)} 与 ${name(r.companyId)} 有已收录的${r.role === "supplier" ? "供应商" : "客户"}关系。`)} <Link className="text-cyan-200 underline" href={`/?${new URLSearchParams({company:r.followedId,relationship:r.edgeId})}`} onClick={() => trackEvent("company_evidence_view", {entry_point:"connection_reason"})}>{text("Check relationship evidence", "查看关联依据")}</Link></> : text(`You follow ${name(r.followedId)}.`, `你关注了 ${name(r.followedId)}。`)}</li>)}
    </ul>}
    {!publicFeed && item.reasons?.some(r => r.edgeId) && <p className="mt-2 text-xs text-slate-400">{text("One-hop context only; this does not establish an order or financial impact on your followed company.", "仅提示一跳产业链背景，不代表你关注的公司获得订单或受到财务影响。")}</p>}
    {!!item.activity?.length && <InsiderActivitySummary activity={item.activity} />}
    <p className="mt-3 text-xs text-slate-400">{text("Event / announcement", "事件／宣布日期")}: {item.eventDate?.slice(0,10) ?? text("Not specified", "未明确")} · {text("Collected / reviewed", "收录／复核")}: {item.collectedAt.slice(0,10)}</p>
    {historical && <p className="mt-1 text-xs text-amber-200">{text("Earlier event, added later. Collection is not a new business event.", "历史事件后续收录，收录日期不代表新发生的业务事件。")}</p>}
    <details className="mt-3 text-sm" onToggle={e => { if(e.currentTarget.open) trackEvent("company_evidence_view", {entry_point:"update_evidence"}); }}><summary className="cursor-pointer text-cyan-200">{text("View evidence", "查看证据")}</summary><p className="mt-2 text-xs text-slate-400">{text("Source published", "资料发布日期")}: {item.sourceDate?.slice(0,10) ?? text("Unknown", "未注明")}</p><a className="mt-2 inline-block break-words text-cyan-200 underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("company_evidence_view", {entry_point:"source"})}>{item.sourceTitle} ↗</a></details>
    <div className="mt-4 flex flex-wrap gap-4 text-sm text-cyan-200"><Link href={item.mapHref ?? item.href} className="underline" onClick={() => {trackEvent("company_event_map", {entry_point:publicFeed ? "public_feed" : "following"}); trackEvent("company_event_open", {entry_point:publicFeed ? "public_feed_map" : "following_map"});}}>{text("Open in map", "在图谱中打开")}</Link>{item.companyIds.map(id => <Link key={id} href={researchCompanyUrl({id})}>{name(id)}</Link>)}</div>
  </article>;
}
