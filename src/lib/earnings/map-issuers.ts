import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import {changeCached} from '../change-cache';
import { loadCollectionCompanyScope } from '../company-themes/service';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { mapListedCompanies } from '../events/disclosures';
import { configureEarningsMap } from './issuers';

/** Existing scanner checkpoints bind map tickers to verified SEC identities.
 * No provider requests or new collection. Missing identities remain ineligible
 * until the shared SEC scanner resolves them; source payloads cannot enroll one.
 */
export async function loadEarningsMap(db: Firestore, graph?: KnowledgeGraph,
  initialStates?: Map<string, DocumentData | undefined>) {
  const load = async () => {
    const snapshot = graph ?? await loadCollectionCompanyScope(db);
    const companies = mapListedCompanies(snapshot).filter(node => node.market === 'US');
    const identities = new Map<string, string>();
    if (companies.length) {
      const rows = await Promise.all(companies.map(node => db.collection('collectors').doc(`sec-${node.id}`).get()));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i].data();
        initialStates?.set(companies[i].id, row);
        if (row?.companyId === companies[i].id && /^\d{10}$/.test(String(row.cik)) && Number(row.cik) > 0) identities.set(companies[i].id, row.cik);
      }
    }
    return {snapshot, identities};
  };
  // A collector's writable checkpoints must come from this run, not a cached prior run.
  if (initialStates) initialStates.clear();
  const result = initialStates ? await load() : await changeCached(db, `earnings-issuers:${JSON.stringify(graph ?? null)}`,
    ['companies', 'collectors'], load);
  configureEarningsMap(result.snapshot, result.identities);
  return result.snapshot;
}
