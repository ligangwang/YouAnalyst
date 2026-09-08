import { getAdminFirestore } from "@/lib/firebase/admin";
import { INDUSTRY_STARTERS } from "./catalog";
import { buildIndustryGraph, type IndustryGraph } from "./model";

// Bounded per-instance cache and shared in-flight read; no new extraction or writes.
let cached: { expires: number; graph: IndustryGraph } | undefined;
let pending: Promise<IndustryGraph> | undefined;
export async function loadIndustryGraph(): Promise<IndustryGraph> {
  if (cached && cached.expires > Date.now()) return cached.graph;
  if (pending) return pending;
  pending = (async () => {
    const db = getAdminFirestore();
    const docs = await db.getAll(...INDUSTRY_STARTERS.map(({ ticker }) =>
      db.collection("company_graph_runs").doc(`${ticker}_latest_10k`)));
    const graph = buildIndustryGraph(Object.fromEntries(docs.map((doc, index) =>
      [INDUSTRY_STARTERS[index].ticker, doc.data()])));
    cached = { graph, expires: Date.now() + 300_000 };
    return graph;
  })();
  try { return await pending; } finally { pending = undefined; }
}
