import { createHash } from 'node:crypto';
import { loadThemeCatalog } from './catalog';
import { catalogThemeIds } from './catalog-model';
import { applyThemeCatalog } from './catalog-graph';
import { loadThemeRelationships } from '../knowledge-graph/relationship-cache';
import { loadCompanyDocuments } from '../company-document-cache';
import { getAdminFirestore } from '../firebase/admin';
import { loadKnowledgeGraphStructure, loadGraphValuations } from '../knowledge-graph/service';
import { attachCnMarketCaps } from '../knowledge-graph/cn-market-caps';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { type MarketRelationship } from '../knowledge-graph/market-store';
import { loadThemeCompanies } from './service';
import { themedGraph } from './presentation';
import type { CompanyThemeId } from './model';
import { changeCached } from '../change-cache';

/** Complete membership/relationships without unrelated company valuations. */
export async function loadThemeGraphStructure(theme: CompanyThemeId): Promise<KnowledgeGraph> {
  const catalog=await loadThemeCatalog();
  if(!catalogThemeIds(catalog).includes(theme))throw new Error('Unknown or unpublished theme');
  if (theme === 'ai') return applyThemeCatalog(await loadKnowledgeGraphStructure(),theme,catalog);
  const version=createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0,16);
  const db = getAdminFirestore();
  return changeCached(db, `theme-graph:${theme}:${version}`, ['companies', 'company_relationships'], async () => {
    const [companies, relationships] = await Promise.all([loadThemeCompanies(theme, db), loadThemeRelationships(db, theme)]);
    const graph = themedGraph(theme,companies, relationships.docs.map(doc => ({...doc.data(),id:doc.id} as MarketRelationship)),catalog);

    return applyThemeCatalog(graph,theme,catalog);
  });
}

export async function loadThemeGraph(theme: CompanyThemeId, loadedStructure?:KnowledgeGraph): Promise<KnowledgeGraph> {
  const structure=loadedStructure??await loadThemeGraphStructure(theme),db=getAdminFirestore();
  if(theme==='ai')return loadGraphValuations(db,structure);
  const graph=structuredClone(structure);
  const us = graph.nodes.filter(node => node.kind === 'COMPANY' && node.market === 'US');
  // Reuse existing public financial summaries; viewing never initiates a provider call.
  try {
    if (us.length) {
      const values = await loadCompanyDocuments(db, 'company_fundamentals', us.map(node => node.id), 'marketCap');
      values.forEach((doc, index) => {
        const cap = doc.data()?.marketCap;
        if (cap?.status === 'estimated' && cap.currency === 'USD' && Number.isFinite(cap.value) && cap.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(cap.priceDate ?? '')) us[index].marketCap = {value:cap.value,currency:'USD',priceDate:cap.priceDate};
      });
    }
    await attachCnMarketCaps(db, graph);
  } catch (error) { console.error('Theme market cap summaries unavailable', error); }
  return graph;
}
