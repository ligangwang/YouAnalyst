import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { hash, processBatchInTransaction, validateBatch, type ComputeBatch, type Plan } from "./publisher";
import { ResearchError, type Publisher } from "./auth";
export const COLLECTION = "research_batches";
type BatchRecord = { id: string; status: "PREVIEW" | "PUBLISHED"; owner: Publisher; batch: ComputeBatch; batchHash: string; previewToken: string; createdAt: string; expiresAt: string; plan: Plan; publishedAt?: string; result?: { additions: number; updates: number; unchanged: number } };
export function validateInput(value: unknown): ComputeBatch {
  try {
    assert(value && typeof value === "object");
    const b = value as ComputeBatch;
    assert(typeof b.batchId === "string" && b.batchId.length <= 80);
    assert(Array.isArray(b.sources) && b.sources.length <= 200);
    for (const s of b.sources) { assert(typeof s.id === "string" && s.id.length <= 120 && typeof s.title === "string" && s.title.length <= 300 && typeof s.url === "string" && s.url.length <= 2000); }
    assert(Array.isArray(b.relationships));
    for (const r of b.relationships) { assert(Array.isArray(r.facts)); for (const f of r.facts) assert(typeof f.scope === "string" && f.scope.length <= 1200 && typeof f.limitation === "string" && f.limitation.length <= 1200 && Array.isArray(f.sourceIds) && f.sourceIds.length <= 20); }
    validateBatch(b);
    // Explicit field allowlist: clients cannot write publication state or arbitrary fields.
    return { batchId: b.batchId, asOf: b.asOf, sources: b.sources.map(s => ({ id: s.id, url: s.url, title: s.title, sourceDate: s.sourceDate, retrievedAt: s.retrievedAt })), relationships: b.relationships.map(r => ({ source: r.source, target: r.target, type: r.type, facts: r.facts.map(f => ({ state: f.state, scope: f.scope, sourceIds: f.sourceIds, limitation: f.limitation })) })) };
  } catch { throw new ResearchError(400, "Invalid research batch, sources or relationship types"); }
}
function bounded(record: BatchRecord) {
  if (Buffer.byteLength(JSON.stringify(record)) > 700_000) throw new ResearchError(413, "Batch audit is too large; split into smaller batches");
}
export function batchView(record: BatchRecord) {
  return { id: record.id, status: record.status, previewToken: record.previewToken, expiresAt: record.expiresAt, publishedAt: record.publishedAt ?? null, result: record.result ?? { additions: record.plan.changes.filter(c => !c.before).length, updates: record.plan.changes.filter(c => c.before && c.changed).length, unchanged: record.plan.changes.filter(c => !c.changed).length }, changes: record.plan.changes.map(c => ({ id: c.id, changed: c.changed, summary: c.after.summary, commercialStatus: c.after.commercialStatus, evidence: c.after.evidence, facts: c.after.researchFacts })) };
}
export async function previewBatch(db: Firestore, input: unknown, owner: Publisher) {
  const batch = validateInput(input);
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(batch.batchId), snapshot = await tx.get(ref);
    const old = snapshot.data() as BatchRecord | undefined;
    if (old) {
      if (old.owner.sub !== owner.sub) throw new ResearchError(403, "Batch owner mismatch");
      if (old.batchHash !== hash(batch)) throw new ResearchError(409, "Batch ID already belongs to different content");
      if (old.status === "PUBLISHED" || Date.parse(old.expiresAt) > Date.now()) return batchView(old);
    }
    const plan = await processBatchInTransaction(db, tx, batch);
    const record: BatchRecord = { id: batch.batchId, owner, batch, batchHash: hash(batch), status: "PREVIEW", previewToken: randomUUID(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), plan };
    bounded(record); tx.set(ref, record);
    return batchView(record);
  });
}
export async function publishBatch(db: Firestore, id: string, previewToken: string, owner: Publisher) {
  return db.runTransaction(async tx => {
    const ref = db.collection(COLLECTION).doc(id), snapshot = await tx.get(ref);
    const record = snapshot.data() as BatchRecord | undefined;
    if (!record) throw new ResearchError(404, "Batch not found; preview first");
    if (record.owner.sub !== owner.sub) throw new ResearchError(403, "Batch owner mismatch");
    if (record.previewToken !== previewToken) throw new ResearchError(409, "Preview version mismatch");
    if (record.status === "PUBLISHED") return batchView(record);
    if (Date.parse(record.expiresAt) <= Date.now()) throw new ResearchError(409, "Preview expired; request a new preview");
    const plan = await processBatchInTransaction(db, tx, record.batch, record.plan);
    const published: BatchRecord = { ...record, plan, status: "PUBLISHED", publishedAt: new Date().toISOString(), result: { additions: plan.changes.filter(c => !c.before).length, updates: plan.changes.filter(c => c.before && c.changed).length, unchanged: plan.changes.filter(c => !c.changed).length } };
    // Preserve original before-images in the audit record in the same transaction as writes.
    bounded(published); tx.set(ref, published);
    return batchView(published);
  });
}
export async function getBatch(db: Firestore, id: string, owner: Publisher) {
  const record = (await db.collection(COLLECTION).doc(id).get()).data() as BatchRecord | undefined;
  if (!record) throw new ResearchError(404, "Batch not found");
  if (record.owner.sub !== owner.sub) throw new ResearchError(403, "Batch owner mismatch");
  return { ...batchView(record), audit: { owner: record.owner, createdAt: record.createdAt, batchHash: record.batchHash, batch: record.batch, changes: record.plan.changes } };
}
