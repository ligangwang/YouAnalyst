import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { chinaSupplyChain } from "../industry-graph/china";
import { MARKET_COMPANIES, normalizeChinaCompany, validChinaId } from "./china";
import { companyFields } from "../market-companies/model";

// Explicit migration only: public reads must never create or restore records.
export async function seedChinaCompanies(db: Firestore, uid: string) {
  return db.runTransaction(async tx => {
    const refs = chinaSupplyChain.map(c => db.collection(MARKET_COMPANIES).doc(c.id));
    const docs = await tx.getAll(...refs);
    let created = 0;
    const now = new Date().toISOString();
    chinaSupplyChain.forEach((company, i) => {
      if (docs[i].exists) return;
      tx.set(refs[i], { ...company, ...companyFields(company.id,company), market: "CN_A", status: "PUBLISHED", createdAt: now, reviewedAt: now, reviewedBy: uid });
      created++;
    });
    return { created, preserved: refs.length - created };
  });
}

export async function listChinaCompanies(db: Firestore, cursor = "") {
  if (cursor && !validChinaId(cursor)) throw new Error("Invalid company cursor.");
  // Single-field document-ID range avoids a composite index and isolates CN listings.
  let query = db.collection(MARKET_COMPANIES).orderBy(FieldPath.documentId()).startAt("XS").endBefore("XT").limit(100);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const items = snapshot.docs.flatMap(doc => {
    const data = doc.data();
    const company = data.market === "CN_A" && ["PUBLISHED", "DIRECTORY"].includes(data.status) ? normalizeChinaCompany({ ...data, id: doc.id,
      stage: data.stage || data.classification?.[2]?.name || "A 股公司",
      description: data.description || data.classification?.map((c: {name:string}) => c.name).join(" / ") || data.name }) : null;
    return company ? [company] : [];
  });
  return { items, nextCursor: snapshot.size === 100 ? snapshot.docs.at(-1)!.id : null };
}
