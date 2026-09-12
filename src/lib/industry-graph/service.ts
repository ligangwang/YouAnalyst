import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { MAP_PAGE_SIZE, readMapCompany } from "./directory";
import { buildIndustryGraph, type IndustryGraph } from "./model";
import { mergeResearchGraph, type ResearchRelationship } from "../industry-research/model";

export function createIndustryGraphLoader(getDb: () => Firestore) {
const cache = new Map<string, { expires: number; graph: IndustryGraph }>();
const pending = new Map<string, Promise<IndustryGraph>>();
// Bounded reads per page; requesting a ticker never starts a paid extraction.
return async function loadIndustryGraph({ ticker = "", after = "" } = {}): Promise<IndustryGraph> {
  const key = JSON.stringify([ticker, after]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.graph;
  if (pending.has(key)) return pending.get(key)!;
  const work = (async () => {
    const db = getDb();
    let query = db.collection("company_research_runs").where("status", "==", "COMPLETED").orderBy(FieldPath.documentId()).limit(MAP_PAGE_SIZE + 1);
    if (after) query = query.startAfter(after);
    const page = await query.get();
    const docs = page.docs.slice(0, MAP_PAGE_SIZE);
    const runs: Record<string, unknown> = {};
    if (ticker) {
      const requested = await db.collection("company_research_runs").doc(`${ticker}_latest_10k`).get();
      if (requested.exists) runs[ticker] = requested.data();
    }
    for (const doc of docs) {
      const symbol = doc.id.replace(/_latest_10k$/, "");
      if (doc.id === `${symbol}_latest_10k`) runs[symbol] = doc.data();
    }
    const featured = await db.collection("industry_map_companies").where("featured", "==", true).limit(40).get();
    const companies = new Map(featured.docs.flatMap((doc) => {
      const company = readMapCompany(doc.id, doc.data());
      return company ? [[doc.id, company] as const] : [];
    }));
    const symbols = [...new Set([...Object.keys(runs), ...(ticker ? [ticker] : [])])];
    if (symbols.length) {
      const metadata = await db.getAll(...symbols.map((symbol) => db.collection("industry_map_companies").doc(symbol)));
      for (const doc of metadata) {
        const company = readMapCompany(doc.id, doc.data() ?? {});
        if (company) companies.set(doc.id, company);
      }
    }
    if (ticker && !companies.has(ticker)) {
      const listings = await db.collection("market_companies").where("symbol", "==", ticker).limit(20).get();
      const listing = listings.docs.map((doc) => doc.data()).filter((item) => item.active === true && item.predictionSupported === true)
        .sort((a, b) => (Number(b.exchangePriority) || 0) - (Number(a.exchangePriority) || 0))[0];
      const company = listing && readMapCompany(ticker, listing);
      if (company) companies.set(ticker, company);
    }
    const research = await db.collection("industry_research_relationships").where("status", "==", "PUBLISHED").limit(120).get();
    const relations = new Map(research.docs.map(d => [d.id, d.data() as ResearchRelationship]));
    if (ticker) {
      for (const field of ["source", "target"]) {
        const related = await db.collection("industry_research_relationships").where(field, "==", ticker).limit(80).get();
        for (const doc of related.docs) if (doc.data().status === "PUBLISHED") relations.set(doc.id, doc.data() as ResearchRelationship);
      }
    }
    const researchSymbols = [...new Set([...relations.values()].flatMap(r => [r.source, r.target]))];
    const researchCompanies = researchSymbols.length ? (await db.getAll(...researchSymbols.map(s => db.collection("industry_research_companies").doc(s))))
      .flatMap(d => { const c = readMapCompany(d.id, d.data() ?? {}); return c ? [c] : []; }) : [];
    const graph = mergeResearchGraph(buildIndustryGraph(runs, [...companies.values()]), researchCompanies, [...relations.values()]);
    graph.nextCursor = page.docs.length > MAP_PAGE_SIZE ? docs.at(-1)!.id : null;
    if (ticker) graph.requestedTicker = ticker;
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { graph, expires: Date.now() + 300_000 });
    return graph;
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
};
}
export const loadIndustryGraph = createIndustryGraphLoader(getAdminFirestore);
