import { loadCompanyDocuments } from '../company-document-cache';
import { loadThemeEnrolledCompanies } from './company-cache';
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { KnowledgeGraph } from "./model";
import { graphFromMarket, type MarketCompany, type MarketRelationship } from "./market-store";
import { loadPublishedRelationships, relationshipBelongsToTheme } from './relationship-cache';
import { attachCnMarketCaps } from "./cn-market-caps";
import { loadNvidiaManufacturingProjection } from "./nvidia-manufacturing-projection";
import { changeCached } from '../change-cache';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
type GraphOptions = { db?: Firestore; companies?: DocumentSnapshot[] };
/** Identity and sourced relationships do not depend on valuation enrichment. */
export async function loadKnowledgeGraphStructure(options: GraphOptions = {}): Promise<KnowledgeGraph> {
  const db = options.db ?? getAdminFirestore();
  return changeCached(db, 'knowledge-graph-structure', ['companies', 'company_relationships'], async () => {
    const [companies, edges] = await Promise.all([
      options.companies !== undefined ? { docs: options.companies }
        : loadThemeEnrolledCompanies(db),
      loadPublishedRelationships(db),
    ]);
    // Retain graph layout enrollment without a second indexed company query.
    const rows = companies.docs.map(d => ({ ...d.data(), id: d.id }) as MarketCompany)
      .filter(company => company.inGraph?.status === "PUBLISHED");
    const ids = new Set(rows.map(c => c.id));
    const relationships = edges.docs.map(d => ({ ...d.data(), id: d.id }) as MarketRelationship)
      .filter(relationship => relationshipBelongsToTheme(relationship, 'ai'));
    const neighbors = [...new Set(relationships.filter(r => ids.has(r.source) || ids.has(r.target)).flatMap(r => [r.source, r.target]))].filter(id => !ids.has(id) && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id));
    for (let i = 0; i < neighbors.length; i += 200) {
      const profiles = await loadCompanyDocuments(db, 'companies', neighbors.slice(i, i + 200));
      rows.push(...profiles.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }) as MarketCompany));
    }
    const projection = await loadNvidiaManufacturingProjection(db, rows, relationships);
    const graph = graphFromMarket(projection.companies, projection.records);
    if (!graph.nodes.some(n => n.kind === "COMPANY")) throw new Error("Graph company directory unavailable");
    return graph;
  });
}

async function attachUsMarketCaps(db:Firestore,graph:KnowledgeGraph){
  const usCompanies = graph.nodes.filter(n => n.kind === "COMPANY" && n.id.startsWith("US:"));
  for (let i = 0; i < usCompanies.length; i += 1000) {
    const batch = usCompanies.slice(i, i + 1000);
    const values = await loadCompanyDocuments(db, 'company_fundamentals', batch.map(n => n.id), 'marketCap');
    values.forEach((doc, index) => {
      const cap = doc.data()?.marketCap;
      if (cap?.status === "estimated" && cap.currency === "USD" && typeof cap.value === "number" && Number.isFinite(cap.value) && cap.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(cap.priceDate ?? "")) {
        batch[index].marketCap = { value: cap.value, currency: "USD", priceDate: cap.priceDate };
      }
    });
  }
}

/** Enrich a copy so concurrent metadata readers never observe partial mutation. */
export async function loadGraphValuations(db: Firestore, structure: KnowledgeGraph): Promise<KnowledgeGraph> {
  const graph=structuredClone(structure);
  return changeCached(db,'knowledge-graph-valuations',['company_fundamentals','directory_syncs'],async()=>{
    const results=await Promise.allSettled([attachUsMarketCaps(db,graph),attachCnMarketCaps(db,graph)]);
    const messages=['Graph market cap summaries unavailable','A-share market cap summaries unavailable'];
    results.forEach((result,index)=>{if(result.status==='rejected')console.error(messages[index],result.reason);});
    return graph;
  });
}

export async function loadKnowledgeGraph(options: GraphOptions = {}): Promise<KnowledgeGraph> {
  const db=options.db??getAdminFirestore();
  return loadGraphValuations(db,await loadKnowledgeGraphStructure({...options,db}));
}
