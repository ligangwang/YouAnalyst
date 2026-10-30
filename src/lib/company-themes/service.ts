import { loadSupportedCompanies, loadSupportedCompanyUniverse } from '../company-support/service';
import { loadSingleThemeCompanies } from '../knowledge-graph/company-cache';
import type { ExchangeRegion } from '../market-companies/exchange-region';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { isCollectionCompany, type CompanyThemeId, type ThemedCompany } from './model';
import { loadThemeCatalog } from './catalog';
import { catalogThemeIds } from './catalog-model';

/** Single-field array index; no composite index or extra collection is required. */
export async function loadThemeCompanies(theme: CompanyThemeId, db = getAdminFirestore()): Promise<ThemedCompany[]> {
  if (!catalogThemeIds(await loadThemeCatalog(db)).includes(theme)) throw new Error('Unknown company theme');
  const snapshot = await loadSingleThemeCompanies(db, theme);
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ThemedCompany))
    .filter(company => company.themeIds?.includes(theme) && isCollectionCompany(company) && company.themeMemberships?.[theme]?.status === 'PUBLISHED');
}

/** Compatibility names for callers; every regular job uses the supported selector. */
export const loadCollectionCompanies = loadSupportedCompanies;

export async function loadCollectionCompanyScope(db: Firestore, region?: ExchangeRegion): Promise<KnowledgeGraph> {
  return loadSupportedCompanyUniverse(db,region);
}

// The old graph argument is accepted for callers during rollout, but must never
// add relationship-only neighbors to scheduled job coverage.
export async function loadCollectionUniverse(db = getAdminFirestore(), _legacy?: KnowledgeGraph) {
  void _legacy;
  return loadSupportedCompanyUniverse(db);
}
