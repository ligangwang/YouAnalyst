"use client";
import { useRouter } from 'next/navigation';
import { CompanySearch } from './company-search';
import { useLocale } from './providers/locale-provider';
import { localizedPath } from '@/lib/i18n/urls';
import { companyPageUrl } from '@/lib/market-companies/routes';
export function CompanySearchCard() {
  const router = useRouter(), {locale} = useLocale();
  return <section className="mt-6 flex justify-center"><CompanySearch owner="directory" onSelect={item => router.push(localizedPath(companyPageUrl(item.market === 'GLOBAL' ? item.id : item.symbol, item.market, item.slug), locale))}/></section>;
}
