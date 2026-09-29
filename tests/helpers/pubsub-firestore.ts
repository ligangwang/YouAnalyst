import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";

type Data = Record<string, unknown>;
export function pubsubFirestore() {
  const rows = new Map<string, Data>(), writes: string[] = [];
  let reject: (path: string, data: Data) => boolean = () => false;
  const apply = (path: string, data: Data, merge = false) => {
    rows.set(path, merge ? { ...rows.get(path), ...data } : data); writes.push(path);
  };
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)!, firestore: db,
    get: async () => ({ id: path.split("/").at(-1)!, exists: rows.has(path), data: () => rows.get(path), get: (key: string) => rows.get(path)?.[key] }),
    set: async (data: Data, options?: { merge: boolean }) => { if (reject(path, data)) throw Error("write failed"); apply(path, data, options?.merge); },
  });
  type Ref = ReturnType<typeof ref>;
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      let failed = false;
      const write = (r: Ref, data: Data, merge = false) => {
        failed ||= reject(r.path, data); pending.push(() => apply(r.path, data, merge));
      };
      const result = await fn({ get: (r: Ref) => r.get(), getAll: (...args: Ref[]) => Promise.all(args.filter(r => r.path).map(r => r.get())),
        create: (r: Ref, data: Data) => { assert.ok(!rows.has(r.path)); write(r, data); },
        set: (r: Ref, data: Data, options?: { merge: boolean }) => write(r, data, options?.merge),
        update: (r: Ref, data: Data) => write(r, data, true),
      });
      if (failed) throw Error("transaction failed");
      pending.forEach(write => write()); return result;
    },
  } as unknown as Firestore;
  const log = { runId: "delivery-1", emit: () => {}, stage: () => {} } as unknown as MaintenanceLog;
  return { rows, writes, db, log, reject: (fn: typeof reject) => { reject = fn; } };
}
