import { headers } from "next/headers";
import { localizedMetadata } from "@/lib/i18n/server";
import { LAYERS, RELATIONS, STAGES, layerNames, layerSummaries, relationNames, researchCompanies, researchFilters, roadmap, selectedConnections, stageNames, RESEARCH_PATH, REVIEWED, type Evidence } from "@/lib/research/nvidia-ecosystem";
import { companyLinks } from "@/lib/research/deep-dives";
import { CompanyFollowButton } from "@/components/company-follow-button";
import { EvidenceLink, ResearchMap, ShareResearchView } from "@/components/research-actions";
import styles from "@/components/research-discovery.module.css";

type Params = Promise<{ layer?: string; relation?: string; stage?: string; company?: string; relationship?: string }>;
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams: Params }) {
  const p = await searchParams, filters = researchFilters(p.layer, p.relation, p.stage);
  const zh = (await headers()).get("x-ya-language") === "zh-CN";
  const image = `/research/nvidia-ai-ecosystem/share-image?${new URLSearchParams(filters)}`;
  const metadata = await localizedMetadata({ title: zh ? "英伟达 AI 生态：Blackwell、Vera Rubin 与供应链证据 | YouAnalyst" : "NVIDIA AI ecosystem: Blackwell, Vera Rubin and supply-chain evidence | YouAnalyst", description: zh ? "核查英伟达在芯片、网络、系统、CUDA 与云五个层面的位置，以及台积电、HBM 供应商、系统厂商和云客户的原始证据。" : "NVIDIA across chips, networking, systems, CUDA and cloud: primary evidence on TSMC, HBM suppliers, rack builders, clouds and model labs, with shipped and planned separated.", openGraph: { images: [{url:image,width:1200,height:630,alt:"NVIDIA ecosystem research"}] }, twitter: { card:"summary_large_image", images:[image] } });
  // Keep filtered views distinct for social crawlers.
  const view = new URLSearchParams({layer:filters.layer,relation:filters.kind,stage:filters.stage});
  if (metadata.openGraph) metadata.openGraph.url = `${zh?"/zh-cn":"/en"}${RESEARCH_PATH}?${view}`;
  return metadata;
}
function Source({ e, zh }: { e: Evidence; zh: boolean }) {
  return <><EvidenceLink href={e.url} entryPoint="nvidia_ecosystem" ticker="NVDA">{e.source}</EvidenceLink><span className={styles.muted}> · {e.date ? <time dateTime={e.date}>{e.date}</time> : zh ? "未注明日期" : "Date not stated"}</span></>;
}
export default async function NvidiaEcosystem({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const { layer, kind, stage } = researchFilters(params.layer, params.relation, params.stage);
  const zh = (await headers()).get("x-ya-language") === "zh-CN", lang = zh ? "zh" : "en", prefix = zh ? "/zh-cn" : "/en";
  const rows = selectedConnections(layer, kind, stage);
  const edges = [...new Set(rows.flatMap(r => r.edge ? [r.edge] : []))];
  const companies = ["US:NVDA", ...rows.map(r => r.companyId)];
  const company = companies.includes(params.company ?? "") ? params.company! : "US:NVDA";
  return <main className={styles.section}>
    <a href={`${prefix}/research`}>{zh ? "研究专题" : "Research deep-dives"} ←</a>
    <h1>{zh ? "英伟达 AI 生态：哪些已出货，哪些仍是计划？" : "NVIDIA’s AI ecosystem: what has shipped and what is still a plan?"}</h1>
    <p className={styles.muted}>{zh ? "证据复核" : "Evidence reviewed"}: <time dateTime={REVIEWED}>{REVIEWED}</time> · {zh ? "精选研究，并非全部关系。来源日期与复核日期分别列示。" : "A selected research view, not a complete relationship inventory. Source dates are separate from review dates."}</p>
    <p>{zh ? "英伟达横跨 AI 基础设施的五个层面：芯片、网络、系统、软件与云。它不拥有晶圆厂，依赖台积电制造晶圆、依赖 SK 海力士、美光和三星供应内存，并由戴尔、富士康等厂商组装机架。把所有关系都当作“订单”会混淆证据强度：年报披露、首批交付、已运行机架和意向书是不同的东西。" : "NVIDIA spans five layers of AI infrastructure: chips, networking, systems, software and cloud. It owns no fabs. TSMC makes its wafers, SK hynix, Micron and Samsung supply its memory, and builders such as Dell and Foxconn assemble its racks. Treating every connection as an “order” mixes up the strength of the evidence: an annual-report disclosure, a first delivery, racks running at a partner and a letter of intent are different things."}</p>
    <div className={styles.actions}><CompanyFollowButton companyId="US:NVDA"/><a href={`${prefix}/ticker/NVDA`}>{zh ? "继续研究英伟达" : "Continue researching NVIDIA"}</a><a href={`${prefix}?company=US%3ANVDA`}>{zh ? "在图谱中打开" : "Open in map"}</a><ShareResearchView/></div>

    <h2>{zh ? "关键公司" : "Key companies"}</h2>
    <div className={styles.grid}>{researchCompanies.map(c => { const links = companyLinks(c.id, prefix); return <article className={styles.card} key={c.id}><strong>{c.name[lang]}{c.symbol ? ` · ${c.symbol}` : ""}</strong><p>{c.role[lang]}</p><p>{links ? <><a href={links.page}>{zh ? "公司页面" : "Company page"}</a> · <a href={links.map}>{zh ? "在图谱中打开" : "Open in map"}</a></> : <span className={styles.muted}>{zh ? "尚未收录于公司目录" : "Not yet in the company directory"}</span>}</p></article>; })}</div>

    <h2>{zh ? "英伟达在五个层面的位置" : "NVIDIA’s position across five layers"}</h2>
    <div className={styles.table}><table><caption>{zh ? "层面、位置与来源" : "Layer, position and source"}</caption><thead><tr><th>{zh ? "层面" : "Layer"}</th><th>{zh ? "英伟达的位置" : "NVIDIA’s position"}</th><th>{zh ? "来源" : "Source"}</th></tr></thead><tbody>{layerSummaries.map(s => <tr key={s.layer}><td><strong>{layerNames[s.layer][lang]}</strong><br/><a href={`${prefix}${RESEARCH_PATH}?layer=${s.layer}#connections`}>{zh ? "查看相关关系" : "See connections"} →</a></td><td><p>{s.position[lang]}</p></td><td><Source e={s} zh={zh}/></td></tr>)}</tbody></table></div>

    <h2>{zh ? "产品路线图：已出货与已宣布" : "Product roadmap: shipped vs announced"}</h2>
    <div className={styles.grid}>{roadmap.map(r => <article className={styles.card} key={r.name}><strong>{r.name}</strong><br/><span className={styles.badge}>{stageNames[r.stage][lang]}</span><p><strong>{r.status[lang]}</strong></p><p>{r.summary[lang]}</p><ul className={styles.sources}>{[r, ...(r.also ?? [])].map(e => <li key={e.url}><Source e={e} zh={zh}/></li>)}</ul></article>)}</div>

    <h2 id="connections">{zh ? "供应商、客户与合作伙伴" : "Suppliers, customers and partners"}</h2>
    <form className={styles.actions} action={`${prefix}${RESEARCH_PATH}#connections`}>
      <label>{zh ? "层面 " : "Layer "}<select name="layer" defaultValue={layer}><option value="all">{zh ? "全部" : "All"}</option>{LAYERS.map(l => <option key={l} value={l}>{layerNames[l][lang]}</option>)}</select></label>
      <label>{zh ? "关系 " : "Relationship "}<select name="relation" defaultValue={kind}><option value="all">{zh ? "全部" : "All"}</option>{RELATIONS.map(r => <option key={r} value={r}>{relationNames[r][lang]}</option>)}</select></label>
      <label>{zh ? "状态 " : "Status "}<select name="stage" defaultValue={stage}><option value="all">{zh ? "全部" : "All"}</option>{STAGES.map(s => <option key={s} value={s}>{stageNames[s][lang]}</option>)}</select></label>
      <button type="submit">{zh ? "应用筛选" : "Apply filters"}</button><a href={`${prefix}${RESEARCH_PATH}#connections`}>{zh ? "重置" : "Reset"}</a>
    </form>
    <div className={styles.table}><table><caption>{zh ? "关系与原始依据" : "Connections and primary evidence"} · {rows.length}</caption><thead><tr><th>{zh ? "关系 / 状态" : "Connection / status"}</th><th>{zh ? "依据与边界" : "Evidence and limits"}</th><th>{zh ? "来源与后续研究" : "Source and next step"}</th></tr></thead><tbody>{rows.map(r => { const links = companyLinks(r.companyId, prefix, r.edge); return <tr key={r.id} id={r.id}><td><strong>{r.label[lang]}</strong><br/><span className={styles.badge}>{stageNames[r.stage][lang]}</span> <span className={styles.badge}>{r.status[lang]}</span><p className={styles.muted}>{layerNames[r.layer][lang]} · {relationNames[r.kind][lang]}</p></td><td><p>{r.summary[lang]}</p><details><summary>{zh ? "这条证据未能证明什么？" : "What does this not establish?"}</summary><p>{r.limit[lang]}</p></details></td><td><ul className={styles.sources}>{[r as Evidence, ...(r.also ?? [])].map(e => <li key={e.url}><Source e={e} zh={zh}/></li>)}</ul>{links ? <><a href={links.page}>{zh ? "研究公司" : "Open company"} →</a><br/><a href={links.map}>{zh ? "在图谱中打开" : "Open in map"} →</a></> : <span className={styles.muted}>{zh ? "尚未收录于公司目录" : "Not yet in the company directory"}</span>}</td></tr>; })}</tbody></table></div>
    {!rows.length && <p role="status">{zh ? "此筛选下暂无精选关系。" : "No curated connections match these filters."}</p>}
    {!!edges.length && <ResearchMap key={`${layer}:${kind}:${stage}`} ids={edges} company={company} edge={params.relationship}/>}
    <h2>{zh ? "下一步应验证什么？" : "What should you verify next?"}</h2><p>{zh ? "Vera Rubin 的关键节点是 2026 年秋季起的量产出货：关注云厂商公布的实例上市、系统厂商的交付公告，以及英伟达季度业绩中 Rubin 的收入贡献。意向书和“最多”承诺需要后续采购协议或部署公告来证实。本页保留所引证据的原始范围，未声称每项计划都已实现。" : "The next Vera Rubin checkpoint is production shipments from fall 2026: watch for cloud instance launches, system-builder delivery announcements and Rubin’s revenue contribution in NVIDIA’s quarterly results. Letters of intent and “up to” commitments need a later purchase agreement or deployment announcement. This page preserves the scope of the cited evidence; it does not assume every announced plan has been fulfilled."}</p>
  </main>;
}
