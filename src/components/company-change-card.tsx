"use client";

import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import type { CompanyUpdate } from "@/lib/knowledge-graph/company-updates";
import type { BusinessEvent } from "@/lib/knowledge-graph/business-events";
import { relationshipExplanation, researchCompanyUrl } from "@/lib/knowledge-graph/research-view";
import { trackEvent } from "@/lib/analytics";
import { collectedLater } from "@/lib/knowledge-graph/feed-order";

const LATER_COLLECTION = ["Earlier event, added later. Collection is not a new business event.", "历史事件后续收录，收录日期不代表新发生的业务事件。"] as const;

/** One explanation for the per-card "Added later" marker, shown once above a list of updates. */
export function LaterCollectionNote({ className = "" }: { className?: string }) {
  const { text } = useLocale();
  return <p className={`text-xs leading-5 text-slate-400 ${className}`}><LaterCollectionMarker decorative /> {text("marks an earlier event that was collected recently. The collection date is not a new business event.", "表示较早发生、近期才收录的事件；收录日期不代表新发生的业务事件。")}</p>;
}

function LaterCollectionMarker({ decorative = false }: { decorative?: boolean }) {
  const { text } = useLocale();
  const explanation = text(LATER_COLLECTION[0], LATER_COLLECTION[1]);
  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 px-2 py-0.5 text-[11px] text-amber-200/90" title={decorative ? undefined : explanation}>
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    {text("Added later", "后续收录")}{!decorative && <span className="sr-only">: {explanation}</span>}
  </span>;
}

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

export function CompanyChangeCard({ item, graph, publicFeed = false, evidence = [] }: { item: CompanyUpdate; graph: KnowledgeGraph; publicFeed?: boolean; evidence?: CompanyUpdate[] }) {
  const { text, chinese, locale } = useLocale();
  const name = (id: string) => { const n = graph.nodes.find(n => n.id === id); return n ? companyName(n, locale) : id; };
  const event = item.business;
  const category = event ? ({ ORDER: ["Order", "订单"], CAPACITY: ["Capacity", "扩产"], PRODUCT: ["Product progress", "产品进展"], PARTNERSHIP: ["Partnership change", "合作变更"] } as const)[event.category] : ["Evidence added / reviewed", "证据收录／复核"];
  const edge = graph.relationships.find(e => e.id === item.edgeId);
  const fact = edge?.facts?.find(f => f.id === item.factId);
  const title = event ? (chinese ? event.titleZh : event.title) : edge ? relationshipExplanation(fact ? {...edge, facts:[fact]} : edge, graph, chinese) : item.sourceTitle;
  const eventDay = item.eventDate?.slice(0,10);
  const sourceDay = item.sourceDate?.slice(0,10);
  const shownDay = eventDay ?? sourceDay ?? item.collectedAt.slice(0,10);
  const evidenceTitle = (update: CompanyUpdate) => { const e = graph.relationships.find(r => r.id === update.edgeId); const f = e?.facts?.find(f => f.id === update.factId); return e ? relationshipExplanation(f ? {...e, facts:[f]} : e, graph, chinese) : update.sourceTitle; };
  return <article className="rounded-xl border border-white/10 p-5">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="flex flex-wrap items-center gap-2 text-xs text-cyan-200"><span>{text(category[0], category[1])}{event?.planned && ` · ${text("Planned", "计划中")}`}</span>{collectedLater(item) && <LaterCollectionMarker />}</p>
      <p className="text-xs text-slate-400">{eventDay ? text("Event / announcement", "事件／宣布日期") : sourceDay ? text("Source published", "资料发布日期") : text("Collected / reviewed", "收录／复核")}: <time dateTime={shownDay} className="text-sm font-semibold text-slate-100">{shownDay}</time></p>
    </div>
    <h3 className="mt-2 font-semibold"><Link href={item.href} onClick={() => { trackEvent("company_event_open", {entry_point:publicFeed ? "public_feed" : "following"}); if (event) trackEvent("company_event_map", {entry_point:publicFeed ? "public_feed" : "following"}); }} className="hover:text-cyan-200">{title}</Link></h3>
    <p className="mt-2 text-sm leading-6 text-slate-300">{event && chinese ? event.summaryZh : item.description}</p>
    {!eventDay && <p className="mt-2 text-xs text-slate-400">{text("Event timing is not stated; the date above is not a new business event.", "事件发生日期未明确；上方日期不代表新发生的业务事件。")}</p>}
    {!publicFeed && <ul className="mt-3 space-y-1 border-l-2 border-cyan-800 pl-3 text-xs text-slate-300" aria-label={text("Why this appears", "为何关联到你")}>
      {item.reasons?.map(r => <li key={`${r.followedId}:${r.companyId}:${r.edgeId ?? "direct"}`}>{r.edgeId ? <>{text(`Because ${name(r.companyId)} is a recorded ${r.role} of ${name(r.followedId)}, which you follow.`, `你关注的 ${name(r.followedId)} 与 ${name(r.companyId)} 有已收录的${r.role === "supplier" ? "供应商" : "客户"}关系。`)} <Link className="text-cyan-200 underline" href={`/?${new URLSearchParams({company:r.followedId,relationship:r.edgeId})}`} onClick={() => trackEvent("company_evidence_view", {entry_point:"connection_reason"})}>{text("Check relationship evidence", "查看关联依据")}</Link></> : text(`You follow ${name(r.followedId)}.`, `你关注了 ${name(r.followedId)}。`)}</li>)}
    </ul>}
    {!publicFeed && item.reasons?.some(r => r.edgeId) && <p className="mt-2 text-xs text-slate-400">{text("One-hop context only; this does not establish an order or financial impact on your followed company.", "仅提示一跳产业链背景，不代表你关注的公司获得订单或受到财务影响。")}</p>}
    <p className="mt-3 text-xs text-slate-400">{text("Collected / reviewed", "收录／复核")}: {item.collectedAt.slice(0,10)}</p>
    {evidence.length > 0 && <details className="mt-3 text-sm" onToggle={e => { if(e.currentTarget.open) trackEvent("company_evidence_view", {entry_point:"grouped_evidence"}); }}><summary className="cursor-pointer text-cyan-200">{text(`Evidence added / reviewed for this event (${evidence.length})`, `该事件的证据收录／复核（${evidence.length}）`)}</summary>
      <ul className="mt-2 space-y-3 border-l-2 border-cyan-800 pl-3">{evidence.map(update => <li key={update.id} className="text-xs leading-5 text-slate-300">
        <p className="font-medium text-slate-100">{evidenceTitle(update)}</p>
        {update.description && <p className="mt-1">{update.description}</p>}
        <p className="mt-1 text-slate-400">{text("Collected / reviewed", "收录／复核")}: {update.collectedAt.slice(0,10)} · {text("Source published", "资料发布日期")}: {update.sourceDate?.slice(0,10) ?? text("Unknown", "未注明")}</p>
        <a className="mt-1 inline-block break-words text-cyan-200 underline" href={update.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("company_evidence_view", {entry_point:"source"})}>{update.sourceTitle} ↗</a>
      </li>)}</ul>
    </details>}
    <details className="mt-3 text-sm" onToggle={e => { if(e.currentTarget.open) trackEvent("company_evidence_view", {entry_point:"update_evidence"}); }}><summary className="cursor-pointer text-cyan-200">{text("View evidence", "查看证据")}</summary><p className="mt-2 text-xs text-slate-400">{text("Source published", "资料发布日期")}: {item.sourceDate?.slice(0,10) ?? text("Unknown", "未注明")}</p><a className="mt-2 inline-block break-words text-cyan-200 underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("company_evidence_view", {entry_point:"source"})}>{item.sourceTitle} ↗</a></details>
    <div className="mt-4 flex flex-wrap gap-4 text-sm text-cyan-200"><Link href={item.mapHref ?? item.href} className="underline" onClick={() => {trackEvent("company_event_map", {entry_point:publicFeed ? "public_feed" : "following"}); trackEvent("company_event_open", {entry_point:publicFeed ? "public_feed_map" : "following_map"});}}>{text("Open in map", "在图谱中打开")}</Link>{item.companyIds.map(id => <Link key={id} href={researchCompanyUrl({id})}>{name(id)}</Link>)}</div>
  </article>;
}
