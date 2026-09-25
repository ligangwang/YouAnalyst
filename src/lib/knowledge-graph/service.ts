import { getAdminFirestore } from "@/lib/firebase/admin";
import type { KnowledgeGraph } from "./model";
import { graphFromMarket, RELATIONSHIP_COLLECTION, type MarketCompany, type MarketRelationship } from "./market-store";
import { attachCnMarketCaps } from "./cn-market-caps";
let cached: { graph: KnowledgeGraph; expires: number; revision: string } | undefined;
let pending: { promise: Promise<KnowledgeGraph>; revision: string } | undefined;
export async function loadKnowledgeGraph(): Promise<KnowledgeGraph> {
  const db = getAdminFirestore();
  let revision: string;
  try {
    revision = String((await db.collection("directory_syncs").doc("company_names").get()).data()?.revision ?? "");
  } catch (error) {
    if (cached && cached.expires > Date.now()) return cached.graph;
    throw error;
  }
  if (cached && cached.revision === revision && cached.expires > Date.now()) return cached.graph;
  if (pending?.revision === revision) return pending.promise;
  const promise = (async () => {
    const [companies, legacyCompanies, edges] = await Promise.all([
      db.collection("companies").where("inGraph.status", "==", "PUBLISHED").get(),
      db.collection("companies").where("aiGraph.status", "==", "PUBLISHED").get(),
      db.collection(RELATIONSHIP_COLLECTION).where("status", "==", "PUBLISHED").get(),
    ]);
    const companyDocs = [...new Map([...legacyCompanies.docs, ...companies.docs].map(doc => [doc.id, doc])).values()];
    const rows = companyDocs.map(d => ({ ...d.data(), id: d.id }) as MarketCompany);
    const ids = new Set(rows.map(c => c.id));
    const relationships = edges.docs.map(d => ({ ...d.data(), id: d.id }) as MarketRelationship);
    const neighbors = [...new Set(relationships.filter(r => ids.has(r.source) || ids.has(r.target)).flatMap(r => [r.source, r.target]))].filter(id => !ids.has(id) && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id));
    for (let i = 0; i < neighbors.length; i += 200) {
      const profiles = await db.getAll(...neighbors.slice(i, i + 200).map(id => db.collection("companies").doc(id)));
      rows.push(...profiles.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }) as MarketCompany));
    }
    const graph = graphFromMarket(rows, relationships);
    // Project only public valuation summaries; reuse the graph's five-minute cache.
    const usCompanies = graph.nodes.filter(n => n.kind === "COMPANY" && n.id.startsWith("US:"));
    try {
      for (let i = 0; i < usCompanies.length; i += 100) {
        const batch = usCompanies.slice(i, i + 100);
        const values = await db.getAll(...batch.map(n => db.collection("company_fundamentals").doc(n.id.slice(3))), { fieldMask: ["marketCap"] });
        values.forEach((doc, index) => {
          const cap = doc.data()?.marketCap;
          if (cap?.status === "estimated" && cap.currency === "USD" && typeof cap.value === "number" && Number.isFinite(cap.value) && cap.value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(cap.priceDate ?? "")) {
            batch[index].marketCap = { value: cap.value, currency: "USD", priceDate: cap.priceDate };
          }
        });
      }
    } catch (error) {
      console.error("Graph market cap summaries unavailable", error);
    }
    try {
      await attachCnMarketCaps(db, graph);
    } catch (error) {
      console.error("A-share market cap summaries unavailable", error);
    }
    if (!graph.nodes.some(n => n.kind === "COMPANY")) throw new Error("Graph company directory unavailable");
    cached = { graph, expires: Date.now() + 300_000, revision };
    return graph;
  })();
  pending = { promise, revision };
  try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}
