import { permanentRedirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { CompanyTickerContent, companyTickerMetadata } from "@/components/company-ticker-route";
import { chinaCompanyId, companyPageUrl } from "@/lib/market-companies/routes";
import { localizedPath } from "@/lib/i18n/urls";
export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ symbol: string }> }) {
  return chinaCompanyId((await props.params).symbol) ? companyTickerMetadata(props) : {};
}
export default async function LegacyTickerPage({ params, searchParams }: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol } = await params;
  if (chinaCompanyId(symbol)) return <CompanyTickerContent params={params} />;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/.test(symbol)) notFound();
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  permanentRedirect(localizedPath(companyPageUrl(symbol, "US"), locale) + (query.size ? "?" + query : ""));
}
