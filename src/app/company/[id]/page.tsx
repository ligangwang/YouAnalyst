import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyGeography, companyGeographyLabel } from "@/lib/market-companies/identity";
import { localizedMetadata } from "@/lib/i18n/server";
import { localizedPath } from "@/lib/i18n/urls";
import { normalizeCompanyProfile } from "@/lib/company-profile";
import { CompanyProfileDetails } from "@/components/company-profile-details";

export const dynamic = "force-dynamic";
function routeId(raw: string) {
  let id: string;
  try { id = decodeURIComponent(raw); } catch { notFound(); }
  if (!/^ORG:[A-Z0-9][A-Z0-9.-]{0,79}$/.test(id)) notFound();
  return id;
}
const load = cache(async (id: string) => {
  id = routeId(id);
  const doc = await getAdminFirestore().collection("companies").doc(id).get();
  const data = doc.data();
  if (!data || !["PUBLISHED", "DIRECTORY"].includes(data.status) || typeof data.name !== "string") notFound();
  return data;
});
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const data = await load((await params).id);
  return localizedMetadata({ title: `${data.name} | YouAnalyst`, description: String(data.description ?? "") });
}
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const id = routeId((await params).id);
  const data = await load(id);
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const zh = locale === "zh-CN";
  const sources: { url: string; title: string }[] = Array.isArray(data.aiGraph?.sources) ? data.aiGraph.sources.filter((s: { url?: unknown; title?: unknown }) => typeof s.url === "string" && s.url.startsWith("https://") && typeof s.title === "string") : [];
  return <main className="mx-auto max-w-5xl px-6 py-12 text-slate-200">
    <a className="text-cyan-200" href={`${localizedPath("/", locale)}?company=${encodeURIComponent(id)}&market=ALL`}>{zh ? "AI 产业图谱" : "AI Industry Map"} →</a>
    <h1 className="mt-8 text-4xl font-semibold">{data.name}</h1>
    <p className="mt-4 text-slate-400">{companyGeographyLabel(companyGeography(data), locale)}</p>
    <section className="mt-10 rounded-2xl border border-white/10 p-6"><h2 className="text-xl font-semibold">{zh ? "公司概览" : "Company overview"}</h2><p className="mt-4 leading-8">{String(data.description ?? "")}</p>
      <h2 className="mt-8 text-xl font-semibold">{zh ? "资料来源" : "Sources"}</h2><ul className="mt-4 space-y-3">{sources.map((s, i) => <li key={`${s.url}:${i}`}><a className="text-cyan-200" href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a></li>)}</ul>
    </section>
    <CompanyProfileDetails profile={normalizeCompanyProfile(data.profile)} />
  </main>;
}
