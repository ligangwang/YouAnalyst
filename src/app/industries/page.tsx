import { HierarchyBrowser } from '@/components/hierarchy-browser';
import { industryHierarchy } from '@/lib/hierarchy/industries';
import { localizedMetadata } from '@/lib/ui/i18n/server';
import { browseCompanies } from '@/lib/hierarchy/companies';

export async function generateMetadata() {
  return localizedMetadata({ title: 'Industry classifications | YouAnalyst', description: 'Browse SIC and CNI industry classifications, names and hierarchy.', alternates: { canonical: '/industries' } });
}

export default async function IndustriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const taxonomy = typeof params.taxonomy === 'string' ? params.taxonomy.toUpperCase() : '';
  const code = typeof params.code === 'string' ? params.code : '';
  const nodes = industryHierarchy();
  const companies = await browseCompanies('industries', nodes);
  return <HierarchyBrowser kind="industries" nodes={nodes} companies={companies.items} companiesUnavailable={companies.unavailable} selectedId={taxonomy ? `${taxonomy}${code ? `:${code}` : ''}` : code ? `SIC:${code}` : ''} />;
}
