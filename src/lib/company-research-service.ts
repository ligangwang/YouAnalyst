import { cache } from "react";
import { getAdminFirestore } from "./firebase/admin";
import { loadKnowledgeGraph } from "./knowledge-graph/service";
import { companyResearchGraph } from "./knowledge-graph/company-research-projection";
import { buildCompanyResearch } from "./company-research";
import { readCompanyLookup } from "./company-lookup-cache";

// Shared by metadata and page rendering; no new extraction or client-side identity reads.
export const loadCompanyResearch = cache(async (ticker: string) => {
  const [listings, graph] = await Promise.all([
    (async () => {
      try {
        const db = getAdminFirestore();
        const result = await readCompanyLookup(db, db.collection("companies").where("symbol", "==", ticker).limit(20));
        return result.docs.map((doc) => doc.data());
      } catch { return []; }
    })(),
    loadKnowledgeGraph().then(graph=>companyResearchGraph(graph)).catch(() => null),
  ]);
  return buildCompanyResearch(ticker, listings, graph);
});
