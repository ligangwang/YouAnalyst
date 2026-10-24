import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
import { readCompanyLookup } from "@/lib/company-lookup-cache";
import { CompanyCountryFlag } from "@/components/company-country-flag";
import { CompanyClassifications } from '@/components/company-classifications';
import { CompanyResearchPanel } from "@/components/company-research-panel";
import { CompanyOutlook } from "@/components/company-outlook";
import { predictionInstrument } from "@/lib/predictions/instrument";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import {traceCompanyPage,timeCompanyPhase} from '@/lib/company-page-timing';
import { resolveCompanyRoute } from '@/lib/market-companies/slug-resolver';
import { getAdminFirestore } from "@/lib/firebase/admin";
import { companyGeography, companyGeographyLabel } from "@/lib/market-companies/identity";
import { localizedMetadata } from "@/lib/ui/i18n/server";
import { localizedPath } from "@/lib/ui/i18n/urls";
import { normalizeCompanyProfile } from "@/lib/company-profile";
import { CompanyProfileDetails } from "@/components/company-profile-details";
import { reviewedCompanyNames } from "@/lib/market-companies/reviewed-names";
import { CompanyResearchTimeline } from "@/components/company-timeline";
import { nvidiaEditorialCompany } from "@/lib/research/nvidia-manufacturing";
import type { MarketCompany } from "@/lib/knowledge-graph/market-store";

export const dynamic = "force-dynamic";
const load = cache((id: string) => withCompanyPageReads(async()=>{
  const db = getAdminFirestore();
  const doc = await readCompanyLookup(db, db.collection("companies").doc(id));
  const data = nvidiaEditorialCompany(id, doc.exists ? doc.data() ?? {} : undefined);
  if (!data || !["PUBLISHED", "DIRECTORY"].includes(String(data.status)) || typeof data.name !== "string") notFound();
  return { ...data, id } as MarketCompany & { name: string };
}));
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
 return traceCompanyPage('metadata',await headers(),async()=>{
  const resolved = await resolveCompanyRoute((await params).id);
  if (!resolved?.path) notFound();
  if (resolved.id.startsWith('US:') || /^(XSHG|XSHE):/.test(resolved.id)) {
    const {companyTickerMetadata}=await timeCompanyPhase('ticker_module',()=>import('@/components/company-ticker-route'));
    return timeCompanyPhase('metadata_content',()=>companyTickerMetadata({ resolved, params: Promise.resolve({ symbol: resolved.id.startsWith('US:')?resolved.id.slice(3):resolved.id }) }));
  }
  const data = await load(resolved.id);
  return localizedMetadata({ title: `${data.name} | YouAnalyst`, description: String(data.description ?? ""), alternates: { canonical: resolved.path } }, { usePageCanonical: true });
 });
}
export default async function CompanyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
 return traceCompanyPage('page',await headers(),async()=>{
  const rawId = (await params).id;
  const resolved = await resolveCompanyRoute(rawId);
  if (!resolved?.path) notFound();
  const id = resolved.id;
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  if (decodeURIComponent(`/company/${rawId}`) !== decodeURIComponent(resolved.path)) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    permanentRedirect(localizedPath(resolved.path, locale) + (query.size ? `?${query}` : ""));
  }
  if (id.startsWith('US:') || /^(XSHG|XSHE):/.test(id)) {
    // Begin the company's data read before evaluating the heavier content/chart
    // module. Import time and I/O now overlap on a fresh server instance.
    const financialModule=id.startsWith('US:')?await timeCompanyPhase('financial_module',()=>import('@/lib/fundamentals/service')):null;
    const pendingFundamentals=financialModule?timeCompanyPhase('financials',()=>financialModule.loadCompanyFundamentals(id.slice(3))):undefined;
    void pendingFundamentals?.catch(()=>undefined);
    const {CompanyTickerContent}=await timeCompanyPhase('ticker_module',()=>import('@/components/company-ticker-route'));
    // Invoke the server component inside this trace; its Suspense children retain
    // the async context while rendering independently.
    return timeCompanyPhase('ticker_content',()=>CompanyTickerContent({resolved,pendingFundamentals,params:Promise.resolve({symbol:id.startsWith('US:')?id.slice(3):id})}));
  }
  const data = await load(id);
  const zh = locale === "zh-CN";
  const identity = companyGeography(data);
  const callTicker = identity.listingStatus === "PRIVATE" ? undefined : identity.listings.map(listing =>
    listing.market === "US" ? listing.symbol : `${listing.exchange}:${listing.symbol}`
  ).find(ticker => predictionInstrument(ticker));
  const membership = data.inGraph;
  const sources: { url: string; title: string }[] = Array.isArray(membership?.sources) ? membership.sources.filter((s: { url?: unknown; title?: unknown }) => typeof s.url === "string" && s.url.startsWith("https://") && typeof s.title === "string") : [];
  return <main className="mx-auto max-w-5xl px-6 py-12 text-slate-200">
    <a className="text-cyan-200" href={`${localizedPath("/", locale)}?company=${encodeURIComponent(id)}&market=ALL`}>{zh ? "AI 产业图谱" : "AI Industry Map"} →</a>
    <h1 className="mt-8 text-4xl font-semibold"><CompanyCountryFlag country={identity.country} locale={locale} />{data.name}</h1>
    <p className="mt-4 text-slate-400">{companyGeographyLabel(companyGeography(data), locale)}</p>
    {typeof data.editorialReviewedAt === "string" && <p className="mt-3 text-xs text-slate-400">{zh ? "编辑公司资料 · 复核于" : "Editorial company profile · reviewed"} {data.editorialReviewedAt}</p>}
    <CompanyProfileDetails profile={normalizeCompanyProfile(data.profile)} />
    <CompanyClassifications companyId={id} data={data} />
    {callTicker && <CompanyOutlook ticker={callTicker} />}
    <CompanyResearchTimeline company={{ id, kind: "COMPANY", order: 0, name: data.name, names: reviewedCompanyNames(id, data.name, data.names), country: identity.country, market: "GLOBAL", listingStatus: identity.listingStatus, summary: String(data.description ?? "") }} />
    <CompanyResearchPanel companyId={id} />
    <section id="company-information" className="mt-10 rounded-2xl border border-white/10 p-6"><h2 className="text-xl font-semibold">{zh ? "公司概览" : "Company overview"}</h2><p className="mt-4 leading-8">{String(data.description ?? "")}</p>
      <h2 className="mt-8 text-xl font-semibold">{zh ? "资料来源" : "Sources"}</h2><ul className="mt-4 space-y-3">{sources.map((s, i) => <li key={`${s.url}:${i}`}><a className="text-cyan-200" href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a></li>)}</ul>
    </section>

  </main>;
 });
}
