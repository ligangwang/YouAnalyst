import { headers } from "next/headers";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "@/lib/knowledge-graph/sectors";
import { companyPageUrl } from "@/lib/market-companies/routes";
import { localizedPath } from "@/lib/i18n/urls";

// Stream useful HTML independently so Firestore never delays the interactive map shell.
export async function AiMapDirectory() {
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const zh = locale === "zh-CN";
  const graph = await loadKnowledgeGraph().catch(() => null);
  if (!graph) return null;
    const companies = graph.nodes.filter(n => n.kind === "COMPANY");
    const profile = (id: string, symbol?: string, market?: string) => localizedPath(companyPageUrl(id.startsWith("US:") ? symbol ?? id.slice(3) : id, market), locale);
    return <section className="mx-auto w-full max-w-6xl px-4 pb-8 text-sm text-slate-400" aria-label={zh ? "AI 公司与产业链" : "AI companies and supply chain"}>
      <details className="rounded-2xl border border-white/10 p-5">
        <summary className="cursor-pointer text-cyan-200">{zh ? "探索 AI 公司与产业链" : "Explore AI stocks, companies and the supply chain"}</summary>
        <p className="my-5 leading-7">{zh ? "探索美股与 A 股 AI 公司，从芯片、内存与通信，到数据中心、云平台与 AI 应用。查看公司资料与原始来源，了解人工智能产业链。产业归属不代表公司之间存在供应关系。" : "Explore US-listed and China A-share AI companies, from chips, memory and networking to data centers, cloud platforms and AI applications. Read company profiles and original sources to understand the AI supply chain. Shared sectors do not imply supplier relationships."}</p>
        {[...GRAPH_SECTORS, OTHER_SECTOR].map(sector => {
          const members = companies.filter(n => companySector(n).id === sector.id);
          if (!members.length) return null;
          return <section key={sector.id} className="mt-6"><h2 className="text-base font-semibold text-slate-200">{zh ? sector.zh : sector.en}</h2><ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{members.map(n => <li key={n.id}><a className="text-cyan-200 hover:underline" href={profile(n.id, n.symbol, n.market)}>{n.name} · {n.symbol}</a><p className="mt-1 leading-6">{n.summary}</p></li>)}</ul></section>;
        })}
        <h2 className="mt-7 text-base font-semibold text-slate-200">{zh ? "已收录公司关系" : "Documented company relationships"}</h2>
        <ul className="mt-3 space-y-3">{graph.relationships.filter(e => e.type !== "PARTICIPATES_IN").map(e => {
          const source = companies.find(n => n.id === e.source), target = companies.find(n => n.id === e.target);
          if (!source || !target) return null;
          return <li key={e.id}><a className="text-cyan-200" href={profile(source.id, source.symbol, source.market)}>{source.name}</a> → <a className="text-cyan-200" href={profile(target.id, target.symbol, target.market)}>{target.name}</a><p>{e.summary}</p>{graph.sources.filter(s => e.sourceIds.includes(s.id) && s.url.startsWith("https://")).map(s => <a key={s.id} className="mr-3 underline" href={s.url} rel="noopener noreferrer" target="_blank">{s.title} ↗</a>)}</li>;
        })}</ul>
      </details>
    </section>;
}
