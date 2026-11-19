import { Storage, type Bucket } from "@google-cloud/storage";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { decode, encode } from "../central-cache/codec";
import { applyMutation } from "../market-store/value";

export type WorkerKind = "sec" | "cn";
type Task = { execution: string; index: number; attempt: number };
type Change<T> = { result: T; next?: DocumentData };
export type WorkerControl = {
  read(): Promise<DocumentData>;
  change<T>(edit: (current: DocumentData) => Change<T>): Promise<T>;
};

export const workerObjectName = (kind: WorkerKind) => `worker-state/v1/fundamentals/${kind}.json`;

async function retryConflict<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      // An overwritten generation can disappear between metadata lookup and download.
      const code = Number((error as { code?: number }).code);
      if (attempt >= 6 || ![404, 412, 429].includes(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(1500, 50 * 2 ** attempt) + Math.random() * 80));
    }
  }
}

export function bucketWorkerControl(bucket: Bucket, kind: WorkerKind): WorkerControl {
  const name = workerObjectName(kind);
  const file = bucket.file(name);
  async function snapshot() {
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation);
    const [bytes] = await bucket.file(name, { generation }).download();
    const state = decode(JSON.parse(bytes.toString()));
    if (!state || Object.getPrototypeOf(state) !== Object.prototype) throw Error("Invalid fundamentals worker checkpoint");
    return { state, generation };
  }
  return {
    read: () => retryConflict(async () => (await snapshot()).state),
    change: <T>(edit: (state: DocumentData) => Change<T>) => retryConflict(async () => {
      const { state, generation } = await snapshot();
      const { result, next } = edit(state);
      if (next) {
        await file.save(JSON.stringify(encode(next)), {
          resumable: false,
          metadata: { contentType: "application/json", cacheControl: "private, no-store" },
          preconditionOpts: { ifGenerationMatch: generation },
        });
      }
      return result;
    }),
  };
}

let storage: Storage | undefined;
export function financialControl(kind: WorkerKind) {
  const name = process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
  if (!name) throw Error("Missing financial worker bucket");
  storage ??= new Storage();
  return bucketWorkerControl(storage.bucket(name), kind);
}

export function acquireWorker(control: WorkerControl, owner: string, now = Date.now(), task?: Task) {
  return control.change<DocumentData | null>(state => {
    const previous = state.leaseTask;
    const recovering = task && previous?.execution === task.execution && previous.index === task.index && task.attempt > previous.attempt;
    if (Number(state.leaseExpiresAtMs) > now && !recovering) return { result: null };
    const next: DocumentData = { ...state, leaseOwner: owner, leaseExpiresAtMs: now + 30 * 60_000 };
    if (task) next.leaseTask = task;
    else delete next.leaseTask;
    return { result: state, next };
  });
}

export function releaseWorker(control: WorkerControl, owner: string) {
  return control.change(state => {
    if (state.leaseOwner !== owner) return { result: undefined };
    const next = { ...state };
    delete next.leaseOwner;
    delete next.leaseExpiresAtMs;
    delete next.leaseTask;
    return { next, result: undefined };
  });
}

export function patchWorker(control: WorkerControl, values: DocumentData) {
  return control.change(state => ({
    result: undefined,
    next: applyMutation(state, "set", [values, { merge: true }], Timestamp.now())!,
  }));
}
