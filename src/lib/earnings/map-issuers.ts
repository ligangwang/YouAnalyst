import type { Firestore } from 'firebase-admin/firestore';
import { loadCollectionUniverse } from '../company-themes/service';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { mapListedCompanies } from '../events/disclosures';
import { configureEarningsMap } from './issuers';

/** Existing scanner checkpoints bind map tickers to verified SEC identities.
 * No provider requests or new collection. Missing identities remain ineligible
 * until the shared SEC scanner resolves them; source payloads cannot enroll one.
 */
export async function loadEarningsMap(db: Firestore, graph?: KnowledgeGraph) {
  const snapshot = graph ?? await loadCollectionUniverse(db);
  const companies = mapListedCompanies(snapshot).filter(node => node.market === 'US');
  const identities = new Map<string, string>();
  if (companies.length) {
    const rows = await Promise.all(companies.map(node => db.collection('collectors').doc(`sec-${node.id}`).get()));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].data();
      if (row?.companyId === companies[i].id && /^\d{10}$/.test(String(row.cik)) && Number(row.cik) > 0) identities.set(companies[i].id, row.cik);
    }
  }
  configureEarningsMap(snapshot, identities);
  return snapshot;
}
