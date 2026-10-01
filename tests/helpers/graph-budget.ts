import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
export function budgetFixture() {
  const rows = new Map<string, Record<string, unknown>>();
  let tail = Promise.resolve();
  const ref = (path: string) => ({ path, get: async () => ({ data: () => rows.has(path) ? structuredClone(rows.get(path)) : undefined }) });
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const next = tail.then(async () => {
        const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
        const result = await fn({ get: async (r: ReturnType<typeof ref>) => { assert.equal(writes.length, 0); return r.get(); },
          set: (r: ReturnType<typeof ref>, data: Record<string, unknown>) => writes.push({ path: r.path, data }) });
        for (const w of writes) rows.set(w.path, { ...rows.get(w.path), ...structuredClone(w.data) });
        return result;
      });
      tail = next.then(() => undefined, () => undefined); return next;
    } } as unknown as Firestore;
  return { db, rows };
}
