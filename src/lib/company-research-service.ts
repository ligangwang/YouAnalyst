import {withCompanyPageReads} from './local-cache/company-page-scope';
import { cache } from "react";
import { getAdminFirestore } from "./firebase/admin";
import { loadKnowledgeGraph } from "./knowledge-graph/service";
import { companyResearchGraph } from "./knowledge-graph/company-research-projection";
import { buildCompanyResearch } from "./company-research";
import { readCompanyLookup } from "./company-lookup-cache";

// Metadata and page content share the complete graph computation as well as I/O.
export const loadCompanyPageGraph=cache(()=>withCompanyPageReads(()=>loadKnowledgeGraph()));

// Shared by metadata and page rendering; no new extraction or client-side identity reads.
export const loadCompanyResearch = cache((ticker: string) => withCompanyPageReads(async()=>{
  const [listings, graph] = await Promise.all([
    (async () => {
      try {
        const db = getAdminFirestore();
        const result = await readCompanyLookup(db, db.collection("companies").where("symbol", "==", ticker).limit(20));
        return result.docs.map((doc) => doc.data());
      } catch { return []; }
    })(),
    loadCompanyPageGraph().then(graph=>companyResearchGraph(graph)).catch(() => null),
  ]);
  return buildCompanyResearch(ticker, listings, graph);
}));
