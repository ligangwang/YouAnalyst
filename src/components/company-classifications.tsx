import { headers } from 'next/headers';
import { getAdminFirestore } from '@/lib/firebase/admin';
import { loadCompanyDocuments } from '@/lib/company-document-cache';
import { companyClassificationPaths } from '@/lib/industry-classification/catalog';
import { investmentThemeHierarchy } from '@/lib/hierarchy/investment-themes';
import { companyThemeNodeIds, type CompanyThemeData } from '@/lib/hierarchy/company-memberships';
import { hierarchyHref, hierarchyPath } from '@/lib/hierarchy/model';
import { LocalizedLink as Link } from './localized-link';
import styles from './company-classifications.module.css';

type ClassificationData = CompanyThemeData & { taxonomy?: unknown; classification?: unknown; isDeleted?: boolean };

/** Reuses the entity cache; private/global profiles can pass their already-loaded record. */
export async function CompanyClassifications({ companyId, data }: { companyId: string; data?: ClassificationData }) {
  const locale = (await headers()).get('x-ya-language') === 'zh-CN' ? 'zh-CN' : 'en';
  const zh = locale === 'zh-CN';
  let company = data;
  if (!company) {
    try { company = (await loadCompanyDocuments(getAdminFirestore(), 'companies', [companyId]))[0]?.data() as ClassificationData | undefined; }
    catch { return <p className={styles.unavailable}>{zh ? '分类信息暂时无法加载。' : 'Classification information is temporarily unavailable.'}</p>; }
  }
  if (company?.isDeleted) return null;
  const nodes = await investmentThemeHierarchy();
  const ids = companyThemeNodeIds(company ?? {}, nodes);
  const themePaths = ids.map(id => hierarchyPath(nodes, id)).filter(path => !ids.some(id => id !== path.at(-1)?.id && hierarchyPath(nodes, id).some(node => node.id === path.at(-1)?.id)));
  let industries: ReturnType<typeof companyClassificationPaths> = [];
  try { industries = companyClassificationPaths(company ?? {}, locale); } catch { /* Do not infer or display an incorrect code. */ }
  return <section className={styles.panel} aria-label={zh ? '行业与投资主题' : 'Industry and investment themes'}>
    <div>
      <h2><Link href="/industries">{zh ? '行业分类' : 'Industry'}</Link></h2>
      {industries.length ? industries.map(path => {
        const industry = path.at(-1)!;
        return <nav key={industry.code} aria-label={`${zh ? '行业分类' : 'Industry classification'} ${industry.code}`}>
          <Link href={hierarchyHref('industries', `${company?.taxonomy}:${industry.code}`)}>{industry.name} <small>· {String(company?.taxonomy)} {industry.code}</small></Link>
        </nav>;
      }) : <p>{zh ? '尚未分类' : 'Not classified yet'}</p>}
    </div>
    <div>
      <h2><Link href="/investment-themes">{zh ? '投资主题' : 'Investment themes'}</Link></h2>
      {themePaths.length ? themePaths.map(path => <nav key={path.at(-1)!.id} aria-label={`${zh ? '投资主题路径' : 'Investment theme path'} ${path.at(-1)!.names[locale]}`}>
        {path.map((node, index) => <span key={node.id}>{index > 0 && <span className={styles.separator} aria-hidden="true"> › </span>}<Link href={hierarchyHref('investment-themes', node.id)}>{node.names[locale]}</Link></span>)}
      </nav>) : <p>{zh ? '暂无已发布的主题分类' : 'No published theme assignments yet'}</p>}
    </div>
  </section>;
}
