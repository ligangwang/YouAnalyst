import { getAdminFirestore } from "@/lib/firebase/admin";
import { combineGraphs, type GraphNode, type GraphEdge, type GraphSource, type KnowledgeGraph } from "./model";

let cached: { graph: KnowledgeGraph; expires: number } | undefined;
let pending: Promise<KnowledgeGraph> | undefined;
export async function loadKnowledgeGraph(): Promise<KnowledgeGraph> {
  if (cached && cached.expires > Date.now()) return cached.graph;
  if (pending) return pending;
  pending = (async () => {
    const db = getAdminFirestore();
    const graphs = await Promise.all(["ai-us", "ai-cn-a"].map(async id => {
      const root = db.collection("knowledge_graphs").doc(id);
      const pointer = (await root.get()).data();
      if (pointer?.status !== "READY" || typeof pointer.activeVersion !== "string" || pointer.activeVersion.includes("/")) throw new Error("Graph unavailable");
      const version = root.collection("versions").doc(pointer.activeVersion);
      const metadata = (await version.get()).data();
      if (metadata?.status !== "READY") throw new Error("Graph incomplete");
      const [nodes, edges, sources] = await Promise.all([version.collection("nodes").get(), version.collection("relationships").get(), version.collection("sources").get()]);
      if (nodes.size !== metadata.nodeCount || edges.size !== metadata.relationshipCount || sources.size !== metadata.sourceCount) throw new Error("Graph incomplete");
      return { id, language: id === "ai-us" ? "en" : "zh-CN", asOf: String(metadata.asOf), nodes: nodes.docs.map(d => d.data() as GraphNode), relationships: edges.docs.map(d => d.data() as GraphEdge), sources: sources.docs.map(d => d.data() as GraphSource) };
    }));
    const graph = combineGraphs(graphs);
    cached = { graph, expires: Date.now() + 300_000 };
    return graph;
  })();
  try { return await pending; } finally { pending = undefined; }
}
