import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";

type Data = Record<string, unknown>;
export function earningsFirestore() {
  const rows = new Map<string, Data>(), writes: string[] = [];
  let clock = Date.parse("2026-10-02T11:00:00Z"), reject: (path: string, value: Data) => boolean = () => false;
  let queue = Promise.resolve();
  function merge(before: Data, patch: Data): Data {
    const result = { ...before };
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && value.constructor.name === "DeleteTransform") { delete result[key]; continue; }
      result[key] = value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)
        ? merge((before[key] ?? {}) as Data, value as Data) : structuredClone(value);
    }
    return result;
  }
  const write = (path: string, value: Data, merging = false) => {
    rows.set(path, merging ? merge(rows.get(path) ?? {}, value) : structuredClone(value)); writes.push(path);
  };
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)!, firestore: db,
    get: async () => snapshot(path),
    set: async (value: Data, options?: { merge?: boolean }) => {
      if (reject(path, value)) throw new Error("Injected Firestore commit failure"); write(path, value, options?.merge);
    },
  });
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, ref: ref(path), exists: rows.has(path), readTime: { toMillis: () => clock },
    data: () => rows.has(path) ? structuredClone(rows.get(path)) : undefined,
    get: (field: string) => structuredClone(field.split(".").reduce<unknown>((value, key) => (value as Data | undefined)?.[key], rows.get(path))) });
  type Ref = ReturnType<typeof ref>;
  const collection = (name: string) => {
    const makeQuery = (filters: Array<[string, unknown]> = [], bound = 1000, after = "") => {
      const matching = () => [...rows].filter(([path, value]) => path.startsWith(name + "/") && path.slice(name.length + 1) > after
        && filters.every(([field, expected]) => field.split(".").reduce<unknown>((v, key) => (v as Data | undefined)?.[key], value) === expected))
        .sort(([a], [b]) => a.localeCompare(b));
      return { doc: (id: string) => ref(`${name}/${id}`),
        where: (field: string, op: string, value: unknown) => { assert.equal(op, "=="); return makeQuery([...filters, [field, value]], bound, after); },
        orderBy: () => makeQuery(filters, bound, after), limit: (n: number) => makeQuery(filters, n, after),
        startAfter: (id: string) => makeQuery(filters, bound, id),
        count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
        get: async () => { const docs = matching().slice(0, bound).map(([path]) => snapshot(path)); return { docs, size: docs.length, empty: !docs.length }; },
      };
    };
    return makeQuery();
  };
  const db = { collection, runTransaction: <T>(callback: (tx: unknown) => Promise<T>) => {
    const work = queue.then(async () => {
      const pending: Array<{ path: string; value: Data; merge: boolean }> = [];
      const read = async (r: Ref) => { assert.equal(pending.length, 0, "Firestore transactions require all reads before writes"); return snapshot(r.path); };
      const result = await callback({ get: read, getAll: (...refs: Ref[]) => Promise.all(refs.map(read)),
        create: (r: Ref, value: Data) => { assert(!rows.has(r.path)&&!pending.some(item=>item.path===r.path), 'Document already exists'); pending.push({path:r.path,value,merge:false}); },
        set: (r: Ref, value: Data, options?: { merge?: boolean }) => pending.push({ path: r.path, value, merge: Boolean(options?.merge) }),
      });
      if (pending.some(item => reject(item.path, item.value))) throw new Error("Injected Firestore commit failure");
      pending.forEach(item => write(item.path, item.value, item.merge)); return result;
    });
    queue = work.then(() => undefined, () => undefined); return work;
  } } as unknown as Firestore;
  return { db, rows, writes, now: () => clock, advance: (ms: number) => { clock += ms; }, reject: (fn: typeof reject) => { reject = fn; } };
}
