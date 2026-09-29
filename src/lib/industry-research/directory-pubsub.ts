import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { digest } from "../fundamentals/pubsub";
import { acquireMaintenanceLease, releaseMaintenanceLease } from "../maintenance-lease";
import type { MaintenanceLog } from "../maintenance-log";
import { importCniDirectory, validateCniDirectory } from "./directory-sync";

export type DirectoryRequest = { version: 1; type: "directory.cni.sync.requested"; batchId: string; requestedAt: string };
const ledgerRef = (db: Firestore, id: string) => db.collection("directory_syncs").doc(`_cni_${id}`);
const pageRef = (db: Firestore, id: string, page: number) => db.collection("directory_syncs").doc(`_cni_${id}_page_${page}`);
export function parseDirectoryRequest(input: unknown): DirectoryRequest {
  const v = input as Partial<DirectoryRequest> | null;
  if (!v || v.version !== 1 || v.type !== "directory.cni.sync.requested"
    || typeof v.batchId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.batchId)
    || typeof v.requestedAt !== "string" || !Number.isFinite(Date.parse(v.requestedAt))) throw Error("Invalid directory request");
  return { version: 1, type: v.type, batchId: v.batchId, requestedAt: v.requestedAt };
}
export async function publishDirectoryRequest(db: Firestore, execution: string, publish: (request: DirectoryRequest) => Promise<unknown>) {
  const request = parseDirectoryRequest({ version: 1, type: "directory.cni.sync.requested", batchId: digest({ execution }), requestedAt: new Date().toISOString() });
  const state = db.collection("directory_syncs").doc("CN_A_CNI");
  const saved = await db.runTransaction(async tx => {
    const active = (await tx.get(state)).data()?.activeRequest;
    if (active) return parseDirectoryRequest(active);
    const ref = ledgerRef(db, request.batchId);
    const existing = (await tx.get(ref)).data();
    if (existing) return parseDirectoryRequest(existing.request);
    tx.create(ref, { request });
    tx.set(state, { activeRequest: request }, { merge: true });
    return request;
  });
  await publish(saved);
  return { requested: 1, batchId: saved.batchId, mode: "pubsub" };
}

async function downloadDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "cni-pubsub-"));
  const file = path.join(directory, "snapshot.json");
  try {
    await promisify(execFile)("python3", ["scripts/download-cni-directory.py", file], { timeout: 150_000, windowsHide: true });
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function processDirectoryRequest(input: unknown, db: Firestore, log: MaintenanceLog,
  dependencies: { download?: typeof downloadDirectory; deadline?: number } = {}) {
  const request = parseDirectoryRequest(input), ref = ledgerRef(db, request.batchId);
  const lease = db.collection("directory_syncs").doc("CN_A_CNI");
  if (!await acquireMaintenanceLease(lease, log.runId)) throw Error("Directory worker is busy; retry");
  const deadline = dependencies.deadline ?? Date.now() + 7 * 60_000;
  try {
    const ledger = (await ref.get()).data();
    if (!ledger || digest(ledger.request) !== digest(request)) throw Error("Unknown or conflicting directory request");
    if (ledger.completed) return { ...ledger.result, duplicate: true };
    if ((await lease.get()).data()?.activeRequest?.batchId !== request.batchId) throw Error("Directory request is no longer active");
    let metadata = ledger.metadata, pages = Number(ledger.pages ?? 0);
    if (!ledger.prepared) {
      const { payload, rows } = validateCniDirectory(await (dependencies.download ?? downloadDirectory)());
      metadata = { source: payload.source, snapshot: payload.snapshot, sha256: payload.sha256 };
      pages = Math.ceil(rows.length / 100);
      for (let i = 0; i < pages; i++) {
        if (Date.now() >= deadline - 60_000) throw Error("Directory snapshot preparation requires retry");
        const companies = rows.slice(i * 100, (i + 1) * 100);
        if (Buffer.byteLength(JSON.stringify(companies)) > 700_000) throw Error("Directory snapshot page too large");
        await pageRef(db, request.batchId, i).set({ companies });
      }
      await ref.set({ prepared: true, metadata, pages, offset: 0 }, { merge: true });
    }
    const companies: unknown[] = [];
    for (let i = 0; i < pages; i++) {
      const page = (await pageRef(db, request.batchId, i).get()).data();
      if (!Array.isArray(page?.companies)) throw Error("Directory snapshot page missing");
      companies.push(...page.companies);
    }
    const result = await importCniDirectory(db, { ...metadata, companies }, log, { checkpoint: ref, deadline, owner: log.runId });
    await db.runTransaction(async tx => {
      const active = (await tx.get(lease)).data();
      if (active?.activeRequest?.batchId !== request.batchId || active.leaseOwner !== log.runId
        || Number(active.leaseExpiresAtMs) <= Date.now()) throw Error("Directory completion requires retry");
      tx.set(ref, { completed: true, completedAt: new Date().toISOString(), result }, { merge: true });
      tx.set(lease, { activeRequest: null }, { merge: true });
    });
    return result;
  } finally { await releaseMaintenanceLease(lease, log.runId); }
}
