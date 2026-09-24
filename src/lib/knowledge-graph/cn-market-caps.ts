import type { Firestore } from "firebase-admin/firestore";
import type { KnowledgeGraph } from "./model";
import { CN_COMPANY_ID } from "./cn-companies";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

// Attach public A-share valuation summaries from company_fundamentals/{XSHG|XSHE:code}.
// Nodes are sized by USD; the CNY value and FX rate date travel with it.
export async function attachCnMarketCaps(db: Pick<Firestore, "getAll" | "collection">, graph: Pick<KnowledgeGraph, "nodes">) {
  const companies = graph.nodes.filter(n => n.kind === "COMPANY" && CN_COMPANY_ID.test(n.id));
  for (let i = 0; i < companies.length; i += 100) {
    const batch = companies.slice(i, i + 100);
    const docs = await db.getAll(...batch.map(n => db.collection("company_fundamentals").doc(n.id)), { fieldMask: ["marketCap"] });
    docs.forEach((doc, index) => {
      const cap = doc.data()?.marketCap;
      if (cap?.status !== "estimated" || cap.currency !== "CNY" || !positive(cap.value) || !DATE.test(cap.priceDate ?? "")) return;
      if (!positive(cap.usd?.value) || !DATE.test(cap.usd?.rateDate ?? "")) return;
      batch[index].marketCap = { value: cap.usd.value, currency: "USD", priceDate: cap.priceDate,
        local: { value: cap.value, currency: "CNY", rateDate: cap.usd.rateDate } };
    });
  }
}
