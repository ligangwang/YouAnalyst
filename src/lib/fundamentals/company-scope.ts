import type { Firestore } from 'firebase-admin/firestore';
import { loadCollectionCompanies } from '../company-themes/service';
import { CN_COMPANY_ID } from '../knowledge-graph/cn-companies';
import { usFundamentalsTicker } from './identity';

/** Select canonical company keys without loading graph edges or valuations. */
export async function loadFundamentalsCompanyIds(db: Firestore, market: 'US' | 'CN_A') {
  const companies = await loadCollectionCompanies(db);
  return [...new Set(companies.map(doc => doc.id).filter(id =>
    market === 'US' ? usFundamentalsTicker(id) !== null : CN_COMPANY_ID.test(id)))].sort();
}
