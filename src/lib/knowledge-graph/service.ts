import { COMPANY_THEMES } from "../company-themes/model";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { KnowledgeGraph } from "./model";
import { graphFromMarket, RELATIONSHIP_COLLECTION, type MarketCompany, type MarketRelationship } from "./market-store";
import { attachCnMarketCaps } from "./cn-market-caps";
import { loadNvidiaManufacturingProjection } from "./nvidia-manufacturing-projection";
import { changeCached } from '../change-cache';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
export async function loadKnowledgeGraph(options: { db?: Firestore; companies?: QueryDocumentSnapshot[] } = {}): Promise<KnowledgeGraph> {
  const db = options.db ?? getAdminFirestore();
  let complete=true;
  return changeCached(db, 'knowledge-graph', ['companies', 'company_relationships', 'company_fundamentals', 'directory_syncs'], async () => {
    const [companies, edges] = await Promise.all([
      options.companies !== undefined ? { docs: options.companies }
        : db.collection("companies").where("themeIds", "array-contains-any", [...COMPANY_THEMES]).get(),
      db.collection(RELATIONSHIP_COLLECTION).where("status", "==", "PUBLISHED").get(),
    ]);
    // Retain graph layout enrollment without a second indexed company query.
    const rows = companies.docs.map(d => ({ ...d.data(), id: d.id }) as MarketCompany)
      .filter(company => company.inGraph?.status === "PUBLISHED");
    const ids = new Set(rows.map(c => c.id));
    const relationships = edges.docs.map(d => ({ ...d.data(), id: d.id }) as MarketRelationship);
    const neighbors = [...new Set(relationships.filter(r => ids.has(r.source) || ids.has(r.target)).flatMap(r => [r.source, r.target]))].filter(id => !ids.has(id) && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id));
    for (let i = 0; i < neighbors.length; i += 200) {
      const profiles = await db.getAll(...neighbors.slice(i, i + 200).map(id => db.collection("companies").doc(id)));
      rows.push(...profiles.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }) as MarketCompany));
    }
    const projection = await loadNvidiaManufacturingProjection(db, rows, relationships);
    const graph = graphFromMarket(projection.companies, projection.records);
    // Public valuations are invalidated when fundamentals change.
    const usCompanies = graph.nodes.filter(n => n.kind === "COMPANY" && n.id.startsWith("US:"));
    try {
      for (let i = 0; i < usCompanies.length; i += 100) {
        const batch = usCompanies.slice(i, i + 100);
        const values = await db.getAll(...batch.map(n => db.collection("company_fundamentals").doc(n.id)), { fieldMask: ["marketCap"] });
        values.forEach((doc, index) => {
          const cap = doc.data()?.marketCap;
          if (cap?.status === "estimated" && cap.currency === "USD" && typeof cap.value === "number" && Number.isFinite(cap.value) && cap.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(cap.priceDate ?? "")) {
            batch[index].marketCap = { value: cap.value, currency: "USD", priceDate: cap.priceDate };
          }
        });
      }
    } catch (error) {
      complete=false;
      console.error("Graph market cap summaries unavailable", error);
    }
    try {
      await attachCnMarketCaps(db, graph);
    } catch (error) {
      complete=false;
      console.error("A-share market cap summaries unavailable", error);
    }
    if (!graph.nodes.some(n => n.kind === "COMPANY")) throw new Error("Graph company directory unavailable");
    return graph;
  },()=>complete);
}
