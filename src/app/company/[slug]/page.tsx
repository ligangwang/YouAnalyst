import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { TickerPage } from "@/components/ticker-page";
import { companyPath, resolveCompanySlug } from "@/lib/companies";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const company = resolveCompanySlug(slug);
  if (!company) return { title: "Company not found | YouAnalyst" };
  const title = `${company.name} (${company.symbol}) — Company Research | YouAnalyst`;
  const description = `Explore ${company.name}'s disclosed business relationships, institutional ownership, insider activity, and community research.`;
  const url = companyPath(company.symbol);
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
    twitter: { title, description },
  };
}

export default async function CompanyPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const company = resolveCompanySlug(slug);
  if (!company) notFound();
  const canonical = companyPath(company.symbol);
  if (`/company/${slug}` !== canonical) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    permanentRedirect(`${canonical}${query.size ? `?${query}` : ""}`);
  }
  return <TickerPage ticker={company.symbol} companyName={company.name} sector={company.sector} description={company.thesis} />;
}
