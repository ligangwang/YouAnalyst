import { isDeepStrictEqual } from "node:util";
import type { Firestore } from "firebase-admin/firestore";
import { usFundamentalsId } from "./identity";

/** Offline cutover only: stop old readers/writers before copying their shared state. */
export async function copyLegacyFundamentals(db: Firestore, ticker: string, apply = false) {
  const targetId = usFundamentalsId(ticker);
  const collection = db.collection("company_fundamentals");
  return db.runTransaction(async tx => {
    const source = await tx.get(collection.doc(ticker));
    const target = await tx.get(collection.doc(targetId));
    if (!source.exists) return "missing" as const;
    if (target.exists) {
      if (!isDeepStrictEqual(source.data(), target.data())) {
        throw new Error(`Conflicting fundamentals documents: ${ticker} and ${targetId}`);
      }
      return "identical" as const;
    }
    if (apply) tx.create(collection.doc(targetId), source.data()!);
    return apply ? "copied" as const : "would_copy" as const;
  });
}
