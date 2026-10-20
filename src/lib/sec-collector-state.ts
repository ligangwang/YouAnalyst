import type { Firestore } from "firebase-admin/firestore";

// Operational state must not trigger financial-data listeners.
export const SEC_COLLECTOR_STATE_COLLECTION = "sec_collector_state";

/** Seed operational metadata without overwriting state already migrated by another worker. */
export async function seedSecCollectorMetadata(db: Firestore) {
  const id = "_sec_filings_collector";
  const ref = db.collection(SEC_COLLECTOR_STATE_COLLECTION).doc(id);
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return;
    const legacy = (await tx.get(db.collection("company_fundamentals").doc(id))).data();
    tx.set(ref, legacy ?? {});
  });
}
