import { permanentRedirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { CompanyTickerContent, companyTickerMetadata } from "@/components/company-ticker-route";
import { chinaCompanyId } from "@/lib/market-companies/routes";
import { localizedPath } from "@/lib/i18n/urls";
import { canonicalCompanyPath } from '@/lib/market-companies/slug-resolver';
export const dynamic = "force-dynamic";
function decodeSymbol(symbol: string) {
  try { return decodeURIComponent(symbol); } catch { notFound(); }
}
export async function generateMetadata(props: { params: Promise<{ symbol: string }> }) {
  return chinaCompanyId(decodeSymbol((await props.params).symbol)) ? companyTickerMetadata(props) : {};
}
export default async function LegacyTickerPage({ params, searchParams }: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const symbol = decodeSymbol((await params).symbol);
  const chinaId = chinaCompanyId(symbol);
  if (!chinaId && !/^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/.test(symbol)) notFound();
  const path = await canonicalCompanyPath(chinaId ?? `US:${symbol.toUpperCase()}`);
  if (!path) return <CompanyTickerContent params={params} />;
  const locale = (await headers()).get("x-ya-language") === "zh-CN" ? "zh-CN" : "en";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  permanentRedirect(localizedPath(path, locale) + (query.size ? "?" + query : ""));
}
