import type { GraphNode } from '@/lib/knowledge-graph/model';
import { companySector } from '@/lib/knowledge-graph/sectors';
import styles from './intelligence-event-companies.module.css';

/** The same primary sector and color used by the company map. */
export function IntelligenceEventCompanies({ companyIds, companies, chinese }: {
  companyIds: string[];
  companies: ReadonlyMap<string, GraphNode>;
  chinese: boolean;
}) {
  const sectors = new Map<string, ReturnType<typeof companySector>>();
  const tickers = companyIds.map(id => {
    const company = companies.get(id);
    if (company) {
      const sector = companySector(company);
      sectors.set(sector.id, sector);
    }
    return company?.symbol || company?.name || id;
  }).join(' / ');
  const uniqueSectors = [...sectors.values()];
  const sectorName = (sector: ReturnType<typeof companySector>) => chinese ? sector.zh : sector.en;
  const allNames = uniqueSectors.map(sectorName).join(' / ');
  const extraNames = uniqueSectors.slice(2).map(sectorName).join(' / ');

  return <p className={styles.companies}>
    <span className={uniqueSectors.length ? styles.tickers : styles.onlyTickers} title={tickers}>{tickers}</span>
    {uniqueSectors.length > 0 && <span className={styles.sectors} role="group" aria-label={`${chinese ? '公司行业' : 'Company sectors'}: ${allNames}`} title={allNames}>
      {uniqueSectors.slice(0, 2).map(sector => <span key={sector.id} className={styles.sector}>
        <i className={styles.dot} style={{ backgroundColor: sector.color }} aria-hidden="true" />
        <span className={styles.name}>{sectorName(sector)}</span>
      </span>)}
      {uniqueSectors.length > 2 && <span className={styles.extra} title={extraNames} aria-label={`${chinese ? '其他行业' : 'Additional sectors'}: ${extraNames}`}>+{uniqueSectors.length - 2}</span>}
    </span>}
  </p>;
}
