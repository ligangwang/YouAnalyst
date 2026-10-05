import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import { attachCnMarketCaps } from '../knowledge-graph/cn-market-caps';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { RELATIONSHIP_COLLECTION, type MarketRelationship } from '../knowledge-graph/market-store';
import { loadThemeCompanies } from './service';
import { themedGraph } from './presentation';
import type { CompanyThemeId } from './model';

const caches = new Map<CompanyThemeId,{graph:KnowledgeGraph;expires:number}>();
const requests = new Map<CompanyThemeId,Promise<KnowledgeGraph>>();
export async function loadThemeGraph(theme: CompanyThemeId): Promise<KnowledgeGraph> {
  if (theme === 'ai') return loadKnowledgeGraph();
  const cached=caches.get(theme), pending=requests.get(theme);
  if (cached && cached.expires > Date.now()) return cached.graph;
  if (pending) return pending;
  const request = (async () => {
    const db = getAdminFirestore();
    const [companies, relationships] = await Promise.all([loadThemeCompanies(theme, db), db.collection(RELATIONSHIP_COLLECTION).where('themeIds', 'array-contains', theme).get()]);
    const graph = themedGraph(theme,companies, relationships.docs.map(doc => ({...doc.data(),id:doc.id} as MarketRelationship)));
    if (!graph.nodes.some(node => node.kind === 'COMPANY')) throw new Error('Theme company directory unavailable');
    const us = graph.nodes.filter(node => node.kind === 'COMPANY' && node.market === 'US');
    // Reuse existing public financial summaries; viewing never initiates a provider call.
    try {
      if (us.length) {
        const values = await db.getAll(...us.map(node => db.collection('company_fundamentals').doc(node.id.slice(3))), {fieldMask:['marketCap']});
        values.forEach((doc, index) => {
          const cap = doc.data()?.marketCap;
          if (cap?.status === 'estimated' && cap.currency === 'USD' && Number.isFinite(cap.value) && cap.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(cap.priceDate ?? '')) us[index].marketCap = {value:cap.value,currency:'USD',priceDate:cap.priceDate};
        });
      }
      await attachCnMarketCaps(db, graph);
    } catch (error) { console.error('Theme market cap summaries unavailable', error); }
    caches.set(theme,{graph, expires:Date.now() + 60_000});
    return graph;
  })();
  requests.set(theme,request);
  try { return await request; } finally { if(requests.get(theme)===request)requests.delete(theme); }
}
