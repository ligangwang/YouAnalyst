import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraph } from '../knowledge-graph/service';
import { attachCnMarketCaps } from '../knowledge-graph/cn-market-caps';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { RELATIONSHIP_COLLECTION, type MarketRelationship } from '../knowledge-graph/market-store';
import { loadThemeCompanies } from './service';
import { themedGraph } from './presentation';
import type { CompanyThemeId } from './model';
import { changeCached } from '../change-cache';

export async function loadThemeGraph(theme: CompanyThemeId): Promise<KnowledgeGraph> {
  if (theme === 'ai') return loadKnowledgeGraph();
  const db = getAdminFirestore();
  let complete=true;
  return changeCached(db, `theme-graph:${theme}`, ['companies', 'company_relationships', 'company_fundamentals'], async () => {
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
    } catch (error) { complete=false;console.error('Theme market cap summaries unavailable', error); }
    return graph;
  },()=>complete);
}
