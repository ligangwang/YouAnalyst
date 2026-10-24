import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { loadCompanyDocuments } from '@/lib/company-document-cache';
import { companyClassificationPaths } from '@/lib/industry-classification/catalog';
import { investmentThemeHierarchy } from '@/lib/hierarchy/investment-themes';
import { companyThemeNodeIds, type CompanyThemeData } from '@/lib/hierarchy/company-memberships';
import { hierarchyPath } from '@/lib/hierarchy/model';
import { initialSnapshotWithinBudget } from '@/lib/intelligence/initial-snapshot';
import { CompanyClassificationsView, type CompanyIndustryLabel } from './company-classifications-view';

type ClassificationData = CompanyThemeData & { taxonomy?: unknown; classification?: unknown; isDeleted?: boolean };

/** Reuses the entity cache; private/global profiles can pass their already-loaded record. */
export async function CompanyClassifications({ companyId, data }: { companyId: string; data?: ClassificationData }) {
  let company = data;
  if (!company) {
    try { company = (await withCompanyPageReads(()=>loadCompanyDocuments(getAdminFirestore(), 'companies', [companyId])))[0]?.data() as ClassificationData | undefined; }
    catch { return <CompanyClassificationsView unavailable />; }
  }
  if (company?.isDeleted) return null;
  let industries: CompanyIndustryLabel[] = [];
  try {
    const english = companyClassificationPaths(company ?? {}, 'en');
    const chinese = companyClassificationPaths(company ?? {}, 'zh-CN');
    industries = english.map((path, index) => {
      const industry = path.at(-1)!;
      return { taxonomy: String(company?.taxonomy), code: industry.code,
        names: { en: industry.name, 'zh-CN': chinese[index].at(-1)!.name } };
    });
  } catch { /* Do not infer or display an incorrect code. */ }
  const nodes = await initialSnapshotWithinBudget(investmentThemeHierarchy());
  if (!nodes) return <CompanyClassificationsView industries={industries} themesUnavailable />;
  const ids = companyThemeNodeIds(company ?? {}, nodes);
  const themePaths = ids.map(id => hierarchyPath(nodes, id)).filter(path => !ids.some(id => id !== path.at(-1)?.id && hierarchyPath(nodes, id).some(node => node.id === path.at(-1)?.id)));
  return <CompanyClassificationsView industries={industries} themePaths={themePaths} />;
}
