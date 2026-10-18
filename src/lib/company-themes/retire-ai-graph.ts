import { FieldValue, type Firestore } from 'firebase-admin/firestore';

/** Preserve legacy-only enrollment before removing its redundant field. */
export async function retireAiGraph(db: Firestore, id: string, apply = false) {
  const ref = db.collection('companies').doc(id);
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data || !Object.hasOwn(data, 'aiGraph')) return 'unchanged' as const;
    const copy = data.inGraph === undefined && data.aiGraph != null;
    if (apply) tx.update(ref, {
      ...(copy ? {inGraph: data.aiGraph} : {}),
      aiGraph: FieldValue.delete(),
    });
    return copy ? 'migrate_and_remove' as const : 'remove' as const;
  });
}
