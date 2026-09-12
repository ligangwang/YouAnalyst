import { getAdminFirestore } from "@/lib/firebase/admin";
import type { KnowledgeGraph } from "./model";
import { graphFromMarket, RELATIONSHIP_COLLECTION, type MarketCompany, type MarketRelationship } from "./market-store";
let cached: { graph: KnowledgeGraph; expires: number } | undefined;
let pending: Promise<KnowledgeGraph> | undefined;
export async function loadKnowledgeGraph(): Promise<KnowledgeGraph> {
  if (cached && cached.expires > Date.now()) return cached.graph;
  if (pending) return pending;
  pending = (async () => {
    const db = getAdminFirestore();
    const [companies, edges] = await Promise.all([
      db.collection("companies").where("aiGraph.status", "==", "PUBLISHED").get(),
      db.collection(RELATIONSHIP_COLLECTION).where("status", "==", "PUBLISHED").get(),
    ]);
    const rows = companies.docs.map(d => ({ ...d.data(), id: d.id }) as MarketCompany);
    const ids = new Set(rows.map(c => c.id));
    const relationships = edges.docs.map(d => ({ ...d.data(), id: d.id }) as MarketRelationship);
    const neighbors = [...new Set(relationships.filter(r => ids.has(r.source) || ids.has(r.target)).flatMap(r => [r.source, r.target]))].filter(id => !ids.has(id) && /^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id));
    for (let i = 0; i < neighbors.length; i += 200) {
      const profiles = await db.getAll(...neighbors.slice(i, i + 200).map(id => db.collection("companies").doc(id)));
      rows.push(...profiles.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }) as MarketCompany));
    }
    const graph = graphFromMarket(rows, relationships);
    if (!graph.nodes.some(n => n.kind === "COMPANY")) throw new Error("AI company directory unavailable");
    cached = { graph, expires: Date.now() + 300_000 };
    return graph;
  })();
  try { return await pending; } finally { pending = undefined; }
}
