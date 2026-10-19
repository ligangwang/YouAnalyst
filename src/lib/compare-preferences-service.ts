import type { Firestore } from "firebase-admin/firestore";
import type { CompareAppearance } from "./compare-appearance";

export class CompareProfileNotReadyError extends Error {
  constructor() { super("Your account profile is not ready. Reload the page and try again."); }
}
export async function saveCompareAppearance(db: Firestore, uid: string, appearance: CompareAppearance) {
  const document = db.collection("users").doc(uid);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(document);
    // Profile bootstrap owns document creation; a partial document blocks bootstrap.
    if (!snapshot.exists) throw new CompareProfileNotReadyError();
    transaction.update(document, { compareAppearance: appearance });
  });
}
