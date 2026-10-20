"use client";
import { useRouter } from 'next/navigation';
import { CompanySearch } from './company-search';
import { useLocale } from './providers/locale-provider';
import { localizedPath } from '@/lib/ui/i18n/urls';
import { companyPageUrl } from '@/lib/market-companies/routes';
import styles from './basic-pages.module.css';
export function CompanySearchCard() {
  const router = useRouter(), {locale} = useLocale();
  return <section className={styles.searchCard}><CompanySearch inline owner="directory" onSelect={item => router.push(localizedPath(companyPageUrl(item.market === 'GLOBAL' ? item.id : item.symbol, item.market, item.slug), locale))}/></section>;
}
