import type { Firestore } from "firebase-admin/firestore";

// Serialized transactions model competing application/worker clients sharing Firestore.
export function sharedFirestore() {
  const documents = new Map<string, Record<string, unknown>>();
  let now = 1_000_000;
  let queue = Promise.resolve();
  const snapshot = (id: string) => {
    const value = { ...documents.get(id) };
    return { data: () => value, get: (key: string) => value[key], readTime: { toMillis: () => now } };
  };
  const db = {
    collection: (collection: string) => ({ doc: (id: string) => ({ id: `${collection}/${id}`, get: async () => snapshot(`${collection}/${id}`) }) }),
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const result = queue.then(() => fn({
        get: async (ref: { id: string }) => snapshot(ref.id),
        set: (ref: { id: string }, value: Record<string, unknown>) => documents.set(ref.id, { ...documents.get(ref.id), ...value }),
      }));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  } as unknown as Firestore;
  return { db, documents, now: () => now, advance: (ms: number) => { now += ms; } };
}
