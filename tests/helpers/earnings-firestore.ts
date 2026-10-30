import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { FieldPath } from 'firebase-admin/firestore';

type Data = Record<string, unknown>;
export function earningsFirestore() {
  const rows = new Map<string, Data>(), writes: string[] = [], reads: string[] = [];
  const queries: Array<{collection: string; ids?: string[]}> = [];
  let beforeCommit: (() => void) | undefined;
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
    const makeQuery = (filters: Array<[string | FieldPath, string, unknown]> = [], bound = Infinity, after = "") => {
      const matching = () => [...rows].filter(([path, value]) => path.startsWith(name + "/") && path.slice(name.length + 1) > after
        && filters.every(([field, op, expected]) => {
          const actual = field instanceof FieldPath ? path.slice(name.length + 1) : field.split('.').reduce<unknown>((v, key) => (v as Data | undefined)?.[key], value);
          if (op === '>=') return String(actual) >= String(expected);
          if (op === '<') return String(actual) < String(expected);
          if (op === 'in') return (expected as unknown[]).includes(actual);
          return actual === expected;
        }))
        .sort(([a], [b]) => a.localeCompare(b));
      return { doc: (id: string) => ref(`${name}/${id}`),
        where: (field: string | FieldPath, op: string, value: unknown) => { assert(['==', '>=', '<', 'in'].includes(op)); if(op==='in')assert((value as unknown[]).length<=30); return makeQuery([...filters, [field, op, value]], bound, after); },
        select: () => makeQuery(filters, bound, after),
        orderBy: () => makeQuery(filters, bound, after), limit: (n: number) => makeQuery(filters, n, after),
        startAfter: (id: string) => makeQuery(filters, bound, id),
        count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
        get: async () => { queries.push({collection:name,ids:filters.find(([field,op])=>field instanceof FieldPath&&op==='in')?.[2] as string[]|undefined}); const docs = matching().slice(0, bound).map(([path]) => snapshot(path)); return { docs, size: docs.length, empty: !docs.length }; },
      };
    };
    return makeQuery();
  };
  const db = { collection, runTransaction: <T>(callback: (tx: unknown) => Promise<T>) => {
    const work = queue.then(async () => {
      const pending: Array<{ path: string; value: Data; merge: boolean; create?: boolean }> = [];
      const read = async (r: Ref | {get: () => Promise<unknown>}) => { assert.equal(pending.length, 0, "Firestore transactions require all reads before writes"); if(!('path' in r))return r.get(); reads.push(r.path); return snapshot(r.path); };
      const result = await callback({ get: read, getAll: (...refs: Ref[]) => Promise.all(refs.map(read)),
        create: (r: Ref, value: Data) => { assert(!pending.some(item=>item.path===r.path), 'Duplicate create'); pending.push({path:r.path,value,merge:false,create:true}); },
        set: (r: Ref, value: Data, options?: { merge?: boolean }) => pending.push({ path: r.path, value, merge: Boolean(options?.merge) }),
      });
      const competingCommit=beforeCommit;beforeCommit=undefined;competingCommit?.();
      if (pending.some(item=>item.create&&rows.has(item.path))) throw Object.assign(new Error('Document already exists'),{code:6});
      if (pending.some(item => reject(item.path, item.value))) throw new Error("Injected Firestore commit failure");
      pending.forEach(item => write(item.path, item.value, item.merge)); return result;
    });
    queue = work.then(() => undefined, () => undefined); return work;
  } } as unknown as Firestore;
  return { db, rows, writes, reads, queries, beforeCommit:(fn:()=>void)=>{beforeCommit=fn;}, now: () => clock, advance: (ms: number) => { clock += ms; }, reject: (fn: typeof reject) => { reject = fn; } };
}
