import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { COMPANY_THEMES, collectionUniverse, isCollectionCompany, type CompanyThemeId, type ThemedCompany } from './model';

/** Single-field array index; no composite index or extra collection is required. */
export async function loadThemeCompanies(theme: CompanyThemeId, db = getAdminFirestore()): Promise<ThemedCompany[]> {
  if (!COMPANY_THEMES.includes(theme)) throw new Error('Unknown company theme');
  const snapshot = await db.collection('companies').where('themeIds', 'array-contains', theme).get();
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ThemedCompany))
    .filter(company => isCollectionCompany(company) && company.themeMemberships?.[theme]?.status === 'PUBLISHED');
}

/** Read published memberships from companies, retaining legacy AI enrollment. */
export async function loadCollectionCompanies(db: Firestore) {
  const snapshots = await Promise.all([
    db.collection('companies').where('themeIds', 'array-contains-any', [...COMPANY_THEMES]).get(),
    db.collection('companies').where('inGraph.status', '==', 'PUBLISHED').get(),
    db.collection('companies').where('aiGraph.status', '==', 'PUBLISHED').get(),
  ]);
  return [...new Map(snapshots.flatMap(snapshot => snapshot.docs).map(doc => [doc.id, doc])).values()]
    .filter(doc => isCollectionCompany({ ...doc.data(), id: doc.id } as ThemedCompany));
}

export async function loadCollectionUniverse(db = getAdminFirestore(), legacy?: KnowledgeGraph) {
  const [graph, companies] = await Promise.all([legacy ?? loadKnowledgeGraph(), loadCollectionCompanies(db)]);
  return collectionUniverse(graph, companies.map(doc => ({ ...doc.data(), id: doc.id } as ThemedCompany)));
}
