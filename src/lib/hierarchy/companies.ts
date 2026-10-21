import { getAdminFirestore } from '../firebase/admin';
import { loadCollectionCompanies } from '../company-themes/service';
import { companyClassificationPaths } from '../industry-classification/catalog';
import { companyPageUrl } from '../market-companies/routes';
import { hierarchyPath, type HierarchyNode } from './model';
import { companyThemeNodeIds } from './company-memberships';

export type BrowseCompany = { id: string; name: string; href: string; nodeIds: string[] };
type Membership = { status?: string; primarySector?: string; secondaryRoles?: string[]; assignments?: { nodeId: string; status: string }[] };
type Company = { id: string; name: string; market?: string; slug?: string; taxonomy?: string; classification?: unknown; themeMemberships?: Record<string, Membership>; inGraph?: { stageIds?: string[] } };
let saved: Company[] | undefined;
let refreshAt = 0;
let pending: Promise<Company[]> | undefined;

async function enrolledCompanies() {
  if (saved && Date.now() < refreshAt) return saved;
  if (pending) return pending;
  pending = (async () => {
    const docs = await loadCollectionCompanies(getAdminFirestore());
    saved = docs.filter(doc => doc.data()?.isDeleted !== true).map(doc => ({ ...doc.data(), id: doc.id } as Company));
    refreshAt = Date.now() + 300_000;
    return saved;
  })();
  try { return await pending; } finally { pending = undefined; }
}

export async function browseCompanies(kind: 'industries' | 'investment-themes', nodes: HierarchyNode[]) {
  try {
    const companies = await enrolledCompanies();
    const ids = new Set(nodes.map(node => node.id));
    const items = companies.map(company => {
      const direct = new Set<string>();
      if (kind === 'industries') {
        try { companyClassificationPaths(company).forEach(path => {
          const leaf = path.at(-1); if (leaf) direct.add(`${company.taxonomy}:${leaf.code}`);
        }); } catch { /* Unclassified legacy records must not receive an invented assignment. */ }
      } else companyThemeNodeIds(company, nodes).forEach(id => direct.add(id));
      const nodeIds = [...new Set([...direct].filter(id => ids.has(id)).flatMap(id => hierarchyPath(nodes, id).map(node => node.id)))];
      return { id: company.id, name: company.name, href: companyPageUrl(company.id, company.market, company.slug), nodeIds };
    });
    return { items, unavailable: false };
  } catch { return { items: [] as BrowseCompany[], unavailable: true }; }
}
