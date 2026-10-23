import {withThemeCatalog} from '../helpers/theme-catalog';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
export function memoryFirestore(seed: [string, Record<string, unknown>][] = []) {
  const state = new Map(seed); let chain = Promise.resolve();
  const ref = (collection: string, id: string) => ({ id, path: `${collection}/${id}`, get: async () => snapshot(ref(collection, id)), set: async (data: Record<string, unknown>, opts?: { merge: boolean }) => { state.set(`${collection}/${id}`, opts?.merge ? { ...state.get(`${collection}/${id}`), ...data } : structuredClone(data)); } });
  const snapshot = (r: ReturnType<typeof ref>) => ({ id: r.id, ref: r, exists: state.has(r.path), data: () => structuredClone(state.get(r.path)) });
  function query(collection: string, filters: { field: string; op: string; value: unknown }[] = [], after = '', limit = Infinity) {
    return { doc: (id: string) => ref(collection, id), where: (field: string, op: string, value: unknown) => query(collection, [...filters, { field, op, value }], after, limit), orderBy: () => query(collection, filters, after, limit), startAfter: (id: string) => query(collection, filters, id, limit), limit: (n: number) => query(collection, filters, after, n), get: async () => {
      const docs = [...state].filter(([path, row]) => path.startsWith(collection + '/') && filters.every(f => f.op === 'array-contains' ? Array.isArray(row[f.field]) && (row[f.field] as unknown[]).includes(f.value) : row[f.field] === f.value)).map(([path]) => snapshot(ref(collection, path.slice(collection.length + 1)))).filter(d => d.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      return { docs, size: docs.length };
    } };
  }
  const db = withThemeCatalog({ collection: (name: string) => query(name), getAll: async (...refs: ReturnType<typeof ref>[]) => refs.map(snapshot), runTransaction: async <T>(work: (tx: unknown) => Promise<T>) => {
    const next = chain.then(async () => {
      const pending: { ref: ReturnType<typeof ref>; data: Record<string, unknown>; merge: boolean; create?: boolean }[] = [];
      let writes = false;
      const result = await work({ get: async (r: unknown) => { assert(!writes, 'Reads must precede writes'); const value = r as {path?:string;get:()=>unknown}; return value.path ? snapshot(r as ReturnType<typeof ref>) : value.get(); }, getAll: async (...refs: ReturnType<typeof ref>[]) => { assert(!writes); return refs.map(snapshot); }, set: (r: ReturnType<typeof ref>, data: Record<string, unknown>, opts?: { merge: boolean }) => { writes = true; pending.push({ ref: r, data, merge: !!opts?.merge }); }, update: (r: ReturnType<typeof ref>, data: Record<string, unknown>) => { writes = true; assert(state.has(r.path)); pending.push({ ref: r, data, merge: true }); }, create: (r: ReturnType<typeof ref>, data: Record<string, unknown>) => { writes = true; pending.push({ ref: r, data, merge: false, create: true }); } });
      for (const p of pending) { if (p.create) assert(!state.has(p.ref.path)); state.set(p.ref.path, structuredClone(p.merge ? { ...state.get(p.ref.path), ...p.data } : p.data)); }
      return result;
    }); chain = next.then(() => undefined, () => undefined); return next;
  } } as unknown as Firestore);
  return { db, state };
}
