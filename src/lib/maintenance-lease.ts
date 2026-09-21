import { FieldValue, type DocumentReference } from "firebase-admin/firestore";

// Store the lease on the existing job metadata document. Longer than the 20-minute task timeout.
export async function acquireMaintenanceLease(ref: DocumentReference, owner: string, now = Date.now()) {
  return ref.firestore.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (Number(data?.leaseExpiresAtMs) > now) return false;
    tx.set(ref, { leaseOwner: owner, leaseExpiresAtMs: now + 30 * 60_000 }, { merge: true });
    return true;
  });
}

export async function releaseMaintenanceLease(ref: DocumentReference, owner: string) {
  await ref.firestore.runTransaction(async tx => {
    if ((await tx.get(ref)).get("leaseOwner") === owner) {
      tx.set(ref, { leaseOwner: FieldValue.delete(), leaseExpiresAtMs: FieldValue.delete() }, { merge: true });
    }
  });
}
