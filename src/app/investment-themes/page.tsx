import { HierarchyBrowser } from '@/components/hierarchy-browser';
import { investmentThemeHierarchy } from '@/lib/hierarchy/investment-themes';
import { localizedMetadata } from '@/lib/ui/i18n/server';
import { browseCompanies } from '@/lib/hierarchy/companies';

export async function generateMetadata() {
  return localizedMetadata({ title: 'Investment themes | YouAnalyst', description: 'Explore investment theme families, structural trends and the companies behind them.', alternates: { canonical: '/investment-themes' } });
}

export default async function InvestmentThemesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selectedId = typeof params.node === 'string' ? params.node : typeof params.theme === 'string' ? params.theme : '';
  const nodes = await investmentThemeHierarchy();
  const companies = await browseCompanies('investment-themes', nodes);
  return <HierarchyBrowser kind="investment-themes" nodes={nodes} companies={companies.items} companiesUnavailable={companies.unavailable} selectedId={selectedId} />;
}
