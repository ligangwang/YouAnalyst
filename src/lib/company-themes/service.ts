import { localDocuments } from '../local-cache/entities';
import { loadThemeEnrolledCompanies } from '../knowledge-graph/company-cache';
import type { ExchangeRegion } from '../market-companies/exchange-region';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { COMPANY_THEMES, collectionUniverse, isCollectionCompany, type CompanyThemeId, type ThemedCompany } from './model';

/** Single-field array index; no composite index or extra collection is required. */
export async function loadThemeCompanies(theme: CompanyThemeId, db = getAdminFirestore()): Promise<ThemedCompany[]> {
  if (!COMPANY_THEMES.includes(theme)) throw new Error('Unknown company theme');
  const snapshot = await loadThemeEnrolledCompanies(db);
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ThemedCompany))
    .filter(company => company.themeIds?.includes(theme) && isCollectionCompany(company) && company.themeMemberships?.[theme]?.status === 'PUBLISHED');
}

/** Include negative decisions so legacy graph enrollment cannot override them. */
async function loadEnrollmentRecords(db: Firestore, region?: ExchangeRegion) {
  const local = await localDocuments(db, 'companies', undefined, undefined, undefined, region);
  if (local !== undefined) return local;
  let query = db.collection('companies').where('themeIds', 'array-contains-any', [...COMPANY_THEMES]);
  if (region) query = query.where('exchange_region', '==', region);
  const snapshot = await query.get();
  return snapshot.docs;
}

/** Read published memberships from companies, retaining legacy AI enrollment. */
export async function loadCollectionCompanies(db: Firestore, region?: ExchangeRegion) {
  return (await loadEnrollmentRecords(db, region)).filter(doc => isCollectionCompany({ ...doc.data(), id: doc.id } as ThemedCompany));
}

/** Company metadata for collectors; no relationship expansion or valuation reads. */
export async function loadCollectionCompanyScope(db: Firestore, region?: ExchangeRegion): Promise<KnowledgeGraph> {
  const companies = await loadCollectionCompanies(db, region);
  return collectionUniverse({ nodes: [], relationships: [], sources: [], asOf: '' },
    companies.map(doc => ({ ...doc.data(), id: doc.id } as ThemedCompany)));
}

export async function loadCollectionUniverse(db = getAdminFirestore(), legacy?: KnowledgeGraph) {
  const companies = await loadEnrollmentRecords(db);
  // Reuse the same enrollment snapshot while retaining relationship-only neighbors.
  const graph = legacy ?? await loadKnowledgeGraph({ db, companies });
  return collectionUniverse(graph, companies.map(doc => ({ ...doc.data(), id: doc.id } as ThemedCompany)));
}
