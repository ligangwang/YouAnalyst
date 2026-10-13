import { permanentRedirect } from "next/navigation";
import { companyPath } from "@/lib/companies";

export default async function LegacyTickerPage({ params, searchParams }: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  permanentRedirect(`${companyPath(symbol)}${query.size ? `?${query}` : ""}`);
}
