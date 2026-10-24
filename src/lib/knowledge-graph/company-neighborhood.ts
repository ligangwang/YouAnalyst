import type { Firestore } from 'firebase-admin/firestore';
import { collectionSourceSnapshot } from '../local-cache/read-scope';
import { loadCompanyDocuments } from '../company-document-cache';
import { graphFromMarket, type MarketCompany, type MarketRelationship } from './market-store';
import { relationshipBelongsToTheme } from './relationship-cache';
import { loadKnowledgeGraphStructure } from './service';
import { NVIDIA_MANUFACTURING_FACTS } from '../research/nvidia-manufacturing';

/** Complete direct neighborhood, with the same publication rules as the map.
 * Single-field endpoint queries require no new index and never truncate edges. */
export async function loadCompanyNeighborhood(db: Firestore, id: string, data: Record<string, unknown> | undefined, loadStructure=()=>loadKnowledgeGraphStructure({db})) {
  // Editorial NVIDIA facts include exact-key suppression and synthetic identities.
  // Retain that existing projection for every company it can affect.
  if (id === 'US:NVDA' || NVIDIA_MANUFACTURING_FACTS.some(fact => fact.source === id)) {
    return loadStructure();
  }
  const snapshots = await Promise.all(['source', 'target'].map(async field => {
    const query = db.collection('company_relationships').where(field, '==', id);
    return await (collectionSourceSnapshot(db, query, 'company_relationships') ?? query.get());
  }));
  const records = new Map<string, MarketRelationship>();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) {
    const row = { ...doc.data(), id: doc.id } as MarketRelationship;
    if (row.isDeleted !== true && row.status === 'PUBLISHED' && relationshipBelongsToTheme(row, 'ai')) records.set(doc.id, row);
  }
  const ids = [...new Set([...records.values()].flatMap(row => [row.source, row.target]))]
    .filter(neighbor => neighbor !== id && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(neighbor));
  // Share the existing ID-batch push cache instead of opening a separate stream
  // per neighbor. It retains missing/deleted records and live withdrawals too.
  const neighbors = await loadCompanyDocuments(db, 'companies', ids);
  const companies = neighbors.filter(doc => doc.exists).map(doc => ({ ...doc.data(), id: doc.id }) as MarketCompany);
  if (data) companies.push({ ...data, id } as MarketCompany);
  return graphFromMarket(companies, [...records.values()]);
}
