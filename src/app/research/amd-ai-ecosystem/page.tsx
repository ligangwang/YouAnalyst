import { headers } from "next/headers";
import { localizedMetadata } from "@/lib/i18n/server";
import { researchFilters, selectedConnections, RESEARCH_PATH, REVIEWED } from "@/lib/research/amd-ecosystem";
import { CompanyFollowButton } from "@/components/company-follow-button";
import { EvidenceLink, ResearchMap, ShareResearchView } from "@/components/research-actions";
import styles from "@/components/research-discovery.module.css";

type Params = Promise<{ product?: string; relation?: string; company?: string; relationship?: string }>;
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams: Params }) {
  const p = await searchParams, filters = researchFilters(p.product, p.relation);
  const zh = (await headers()).get("x-ya-language") === "zh-CN";
  const image = `/research/amd-ai-ecosystem/share-image?${new URLSearchParams({...filters, company:typeof p.company === "string" ? p.company : "US:AMD"})}`;
  const metadata = await localizedMetadata({ title: zh ? "AMD AI 生态：EPYC、Instinct 与 Helios 的关系证据 | YouAnalyst" : "AMD AI ecosystem: EPYC, Instinct and Helios evidence | YouAnalyst", description: zh ? "核查 AMD 的晶圆与内存供应、云实例、服务器集成和机架计划。" : "Trace AMD’s wafer and memory suppliers, cloud adoption, server integration and rack plans with primary evidence.", openGraph: { images: [{url:image,width:1200,height:630,alt:"AMD ecosystem research"}] }, twitter: { card:"summary_large_image", images:[image] } });
  // Social crawlers must not collapse different filtered views onto the canonical overview.
  const view = new URLSearchParams({product:filters.product,relation:filters.kind});
  if (typeof p.company === "string" && /^US:[A-Z]{1,6}$/.test(p.company)) view.set("company",p.company);
  if (metadata.openGraph) metadata.openGraph.url = `${zh?"/zh-cn":"/en"}${RESEARCH_PATH}?${view}`;
  return metadata;
}
export default async function AmdEcosystem({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const { product, kind } = researchFilters(params.product, params.relation);
  const zh = (await headers()).get("x-ya-language") === "zh-CN", lang = zh ? "zh" : "en", prefix = zh ? "/zh-cn" : "/en";
  const rows = selectedConnections(product,kind);
  const companies = ["US:AMD", ...rows.map(r=>`US:${r.symbol}`)];
  const company = companies.includes(params.company ?? "") ? params.company! : "US:AMD";
  return <main className={styles.section}>
    <a href={prefix}>{zh ? "AI 产业图谱" : "AI industry map"} ←</a>
    <h1>{zh ? "AMD AI 生态：每条关系究竟证明了什么？" : "AMD’s AI ecosystem: what does each connection prove?"}</h1>
    <p className={styles.muted}>{zh ? "证据复核" : "Evidence reviewed"}: <time dateTime={REVIEWED}>{REVIEWED}</time> · {zh ? "精选研究，并非全部关系。来源日期与复核日期分别列示。" : "A selected research view, not a complete relationship inventory. Source dates are separate from review dates."}</p>
    <p>{zh ? "AMD 设计 EPYC CPU 与 Instinct GPU，并开发 Helios 机架架构。把这些关系都视为“AI 客户”会掩盖差异：AWS 的 CPU 实例、戴尔的 GPU 服务器配置和慧与的机架计划，处于不同产品层次，也提供不同强度的商业证据。" : "AMD designs EPYC CPUs and Instinct GPUs and develops the Helios rack architecture. Counting every connection as an “AI customer” hides important differences: AWS CPU instances, Dell GPU server configurations and HPE rack plans concern different products and provide different kinds of commercial evidence."}</p>
    <div className={styles.actions}><CompanyFollowButton companyId="US:AMD"/><a href={`${prefix}/ticker/AMD`}>{zh ? "继续研究 AMD" : "Continue researching AMD"}</a><ShareResearchView/></div>
    <p>{zh ? "关注 AMD，回到“我的关注”查看有来源的公司及产业链变化。" : "Follow AMD to revisit sourced company and supply-chain changes in Following."}</p>
    <h2>{zh ? "沿产品线阅读证据" : "Read the evidence by product"}</h2>
    <p>{zh ? "EPYC：验证 CPU 云端采用。Instinct：区分上游内存与下游系统集成。Helios：跟踪机架路线图，等待交付或客户部署证据。晶圆制造则是这些产品背后的上游依赖。" : "EPYC: verify CPU cloud adoption. Instinct: separate upstream memory from downstream system integration. Helios: track the rack roadmap and look for delivery or deployment evidence. Wafer manufacturing is an upstream dependency behind the products."}</p>
    <form className={styles.actions} action={`${prefix}${RESEARCH_PATH}`}>
      <label>{zh ? "产品 " : "Product "}<select name="product" defaultValue={product}><option value="all">{zh ? "全部" : "All"}</option>{["EPYC","Instinct","Helios","Manufacturing"].map(p=><option key={p} value={p}>{p==="Manufacturing"&&zh?"晶圆制造":p}</option>)}</select></label>
      <label>{zh ? "关系 " : "Relationship "}<select name="relation" defaultValue={kind}><option value="all">{zh ? "全部" : "All"}</option><option value="supplier">{zh ? "供应商" : "Supplier"}</option><option value="integration">{zh ? "产品采用与集成" : "Adoption / integration"}</option><option value="planned">{zh ? "计划" : "Planned"}</option></select></label>
      <button type="submit">{zh ? "应用筛选" : "Apply filters"}</button><a href={`${prefix}${RESEARCH_PATH}`}>{zh ? "重置" : "Reset"}</a>
    </form>
    <div className={styles.table}><table><caption>{zh ? "关系与原始依据" : "Connections and primary evidence"} · {rows.length}</caption><thead><tr><th>{zh ? "关系 / 状态" : "Connection / status"}</th><th>{zh ? "依据与边界" : "Evidence and limits"}</th><th>{zh ? "来源与后续研究" : "Source and next step"}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} id={r.symbol}><td><strong>{r.label[lang]}</strong><br/><span className={styles.badge}>{r.status[lang]}</span></td><td><p>{r.summary[lang]}</p><details><summary>{zh ? "这条证据未能证明什么？" : "What does this not establish?"}</summary><p>{r.limit[lang]}</p></details></td><td><EvidenceLink href={r.url}>{r.source}</EvidenceLink><p className={styles.muted}>{zh ? "来源日期" : "Source date"}: {r.date ? <time dateTime={r.date}>{r.date}</time> : zh ? "未注明" : "Not stated"}</p><a href={`${prefix}/ticker/${r.symbol}`}>{zh ? "研究公司" : "Open company"} →</a><br/><a href={`${prefix}?${new URLSearchParams({company:"US:AMD",relationship:r.id})}`}>{zh ? "在图谱查看依据" : "Evidence in map"} →</a></td></tr>)}</tbody></table></div>
    {!rows.length && <p role="status">{zh ? "此筛选下暂无精选关系。" : "No curated connections match these filters."}</p>}
    {!!rows.length && <ResearchMap key={`${product}:${kind}`} ids={rows.map(r=>r.id)} company={company} edge={params.relationship}/>}
    <h2>{zh ? "下一步应验证什么？" : "What should you verify next?"}</h2><p>{zh ? "寻找明确产品、客户与交付日期的公告。不要把旧来源的重新收录当作新订单，也不要用合作数量推算收入。本页保留所引证据的原始范围，未声称每项计划都已实现。" : "Look for announcements naming the product, customer and delivery date. A newly indexed old source is not a new order, and connection counts do not measure revenue. This page preserves the scope of the cited evidence; it does not assume every announced plan has been fulfilled."}</p>
  </main>;
}
