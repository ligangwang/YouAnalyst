'use client';

import { hierarchyHref, type HierarchyNode } from '@/lib/hierarchy/model';
import { useLocale } from './providers/locale-provider';
import { LocalizedLink as Link } from './localized-link';
import styles from './company-classifications.module.css';

export type CompanyIndustryLabel = {
  taxonomy: string;
  code: string;
  names: HierarchyNode['names'];
};

/** Use the same active locale as the profile and its localized links. */
export function CompanyClassificationsView({ industries = [], themePaths = [], unavailable = false }: {
  industries?: CompanyIndustryLabel[];
  themePaths?: HierarchyNode[][];
  unavailable?: boolean;
}) {
  const { locale, text } = useLocale();
  if (unavailable) return <p className={styles.unavailable}>{text('Classification information is temporarily unavailable.', '分类信息暂时无法加载。')}</p>;
  return <section className={styles.panel} aria-label={text('Industry and investment themes', '行业与投资主题')}>
    <div>
      <h2><Link href="/industries">{text('Industry', '行业分类')}</Link></h2>
      {industries.length ? industries.map(industry => <nav key={`${industry.taxonomy}:${industry.code}`} aria-label={`${text('Industry classification', '行业分类')} ${industry.code}`}>
        <Link href={hierarchyHref('industries', `${industry.taxonomy}:${industry.code}`)}>{industry.names[locale]} <small>· {industry.taxonomy} {industry.code}</small></Link>
      </nav>) : <p>{text('Not classified yet', '尚未分类')}</p>}
    </div>
    <div>
      <h2><Link href="/investment-themes">{text('Investment themes', '投资主题')}</Link></h2>
      {themePaths.length ? themePaths.map(path => <nav key={path.at(-1)!.id} aria-label={`${text('Investment theme path', '投资主题路径')} ${path.at(-1)!.names[locale]}`}>
        {path.map((node, index) => <span key={node.id}>{index > 0 && <span className={styles.separator} aria-hidden="true"> › </span>}<Link href={hierarchyHref('investment-themes', node.id)}>{node.names[locale]}</Link></span>)}
      </nav>) : <p>{text('No published theme assignments yet', '暂无已发布的主题分类')}</p>}
    </div>
  </section>;
}
