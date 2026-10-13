import { CompanyCountryFlag } from "@/components/company-country-flag";
import { CompanyResearchPanel } from "@/components/company-research-panel";
import { CompanyOutlook } from "@/components/company-outlook";
import { predictionInstrument } from "@/lib/predictions/instrument";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { CompanyTickerContent, companyTickerMetadata } from "@/components/company-ticker-route";
import { organizationCompanyId, organizationCompanyPath, publicCompanyPath, publicCompanyTicker } from "@/lib/market-companies/slugs";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyGeography, companyGeographyLabel } from "@/lib/market-companies/identity";
import { localizedMetadata } from "@/lib/i18n/server";
import { localizedPath } from "@/lib/i18n/urls";
import { normalizeCompanyProfile } from "@/lib/company-profile";
import { CompanyProfileDetails } from "@/components/company-profile-details";
import { reviewedCompanyNames } from "@/lib/market-companies/reviewed-names";
import { CompanyResearchTimeline } from "@/components/company-timeline";
import { nvidiaEditorialCompany } from "@/lib/research/nvidia-manufacturing";
import type { MarketCompany } from "@/lib/knowledge-graph/market-store";

export const dynamic = "force-dynamic";
function routeId(raw: string) {
  let id: string;
  try { id = decodeURIComponent(raw); } catch { notFound(); }
  id = organizationCompanyId(id) ?? id;
  if (!/^ORG:[A-Z0-9][A-Z0-9.-]{0,79}$/.test(id)) notFound();
  return id;
}
const load = cache(async (id: string) => {
  id = routeId(id);
  const doc = await getAdminFirestore().collection("companies").doc(id).get();
  const data = nvidiaEditorialCompany(id, doc.exists ? doc.data() ?? {} : undefined);
  if (!data || !["PUBLISHED", "DIRECTORY"].includes(String(data.status)) || typeof data.name !== "string") notFound();
  return { ...data, id } as MarketCompany & { name: string };
});
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const ticker = publicCompanyTicker(id);
  if (ticker) return companyTickerMetadata({ params: Promise.resolve({ symbol: ticker }) });
  const data = await load(id);
  return localizedMetadata({ title: `${data.name} | YouAnalyst`, description: String(data.description ?? ""), alternates: { canonical: organizationCompanyPath(data.id) } }, { usePageCanonical: true });
}
export default async function CompanyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawId = (await params).id;
  const ticker = publicCompanyTicker(rawId);
  if (ticker) {
    if (`/company/${rawId}` !== publicCompanyPath(ticker)) {
      const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(await searchParams)) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
      }
      permanentRedirect(localizedPath(publicCompanyPath(ticker), locale) + (query.size ? `?${query}` : ""));
    }
    return <CompanyTickerContent params={Promise.resolve({ symbol: ticker })} />;
  }
  const id = routeId(rawId);
  const data = await load(id);
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  if (decodeURIComponent(`/company/${rawId}`) !== decodeURIComponent(organizationCompanyPath(id))) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    permanentRedirect(localizedPath(organizationCompanyPath(id), locale) + (query.size ? `?${query}` : ""));
  }
  const zh = locale === "zh-CN";
  const identity = companyGeography(data);
  const callTicker = identity.listingStatus === "PRIVATE" ? undefined : identity.listings.map(listing =>
    listing.market === "US" ? listing.symbol : `${listing.exchange}:${listing.symbol}`
  ).find(ticker => predictionInstrument(ticker));
  const membership = data.inGraph ?? data.aiGraph;
  const sources: { url: string; title: string }[] = Array.isArray(membership?.sources) ? membership.sources.filter((s: { url?: unknown; title?: unknown }) => typeof s.url === "string" && s.url.startsWith("https://") && typeof s.title === "string") : [];
  return <main className="mx-auto max-w-5xl px-6 py-12 text-slate-200">
    <a className="text-cyan-200" href={`${localizedPath("/", locale)}?company=${encodeURIComponent(id)}&market=ALL`}>{zh ? "AI 产业图谱" : "AI Industry Map"} →</a>
    <h1 className="mt-8 text-4xl font-semibold"><CompanyCountryFlag country={identity.country} locale={locale} />{data.name}</h1>
    <p className="mt-4 text-slate-400">{companyGeographyLabel(companyGeography(data), locale)}</p>
    {typeof data.editorialReviewedAt === "string" && <p className="mt-3 text-xs text-slate-400">{zh ? "编辑公司资料 · 复核于" : "Editorial company profile · reviewed"} {data.editorialReviewedAt}</p>}
    {callTicker && <CompanyOutlook ticker={callTicker} />}
    <CompanyResearchTimeline company={{ id, kind: "COMPANY", order: 0, name: data.name, names: reviewedCompanyNames(id, data.name, data.names), country: identity.country, market: "GLOBAL", listingStatus: identity.listingStatus, summary: String(data.description ?? "") }} />
    <CompanyResearchPanel companyId={id} />
    <section id="company-information" className="mt-10 rounded-2xl border border-white/10 p-6"><h2 className="text-xl font-semibold">{zh ? "公司概览" : "Company overview"}</h2><p className="mt-4 leading-8">{String(data.description ?? "")}</p>
      <h2 className="mt-8 text-xl font-semibold">{zh ? "资料来源" : "Sources"}</h2><ul className="mt-4 space-y-3">{sources.map((s, i) => <li key={`${s.url}:${i}`}><a className="text-cyan-200" href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a></li>)}</ul>
    </section>

    <CompanyProfileDetails profile={normalizeCompanyProfile(data.profile)} />
  </main>;
}
