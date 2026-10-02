import { gzipSync, gunzipSync } from "node:zlib";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { validateSource } from "./document";
import { canonicalJson, sha256, sourceIdentity, stableId, type EarningsRecord, type EarningsSource, type RawEarningsDocument } from "./model";
import { earningsSourceEvent, type EarningsSourceDiscovered } from "./live-event";

// Exact destinations require user approval before live setup; no client access.
export const EARNINGS_SOURCES = "earnings_sources";
export const EARNINGS_RECORDS = "earnings_records";
export const EARNINGS_COLLECTORS = "earnings_collectors";
export const EARNINGS_RECHECK_MS = 24 * 60 * 60_000;
const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 400_000;
const clean = <T>(value: T): T => JSON.parse(canonicalJson(value));
export type EarningsWork = {
  recordType: "source"; source: EarningsSource; sourceId: string; inputKind: "sec_filing" | "document";
  generation: number; status: "queued" | "processing" | "extracted" | "expanded" | "review_required" | "skipped";
  publishPending: boolean; attempts: number; firstSeenAt: string; lastObservedAt: string; nextCheckAtMs: number;
  leaseOwner?: string | null; leaseUntilMs?: number; captureId?: string; revisionId?: string; reason?: string;
  parentCaptureId?: string;
  parentDeliveryId?: string;
  maxExhibits?: number;
  forceChildren?: boolean;
};
export function earningsMetadata(db: Firestore, id: string) {
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(id)) throw new Error("Invalid earnings metadata identity");
  return db.collection(EARNINGS_COLLECTORS).doc(id);
}
export async function discoverEarningsSource(db: Firestore, source: EarningsSource, inputKind: EarningsWork["inputKind"], now = Date.now(), options: { parentCaptureId?: string; parentDeliveryId?: string; force?: boolean; maxExhibits?: number; requireCanaryBounds?: boolean } = {}) {
  validateSource(source);
  if (options.maxExhibits !== undefined && (inputKind !== "sec_filing" || !Number.isInteger(options.maxExhibits) || options.maxExhibits < 1 || options.maxExhibits > 20)) throw new Error("Invalid SEC earnings exhibit budget");
  if (inputKind !== "document" && (inputKind !== "sec_filing" || source.provider !== "sec" || !/^(?:8-K|6-K)(?:\/A)?$/.test(source.form ?? ""))) throw new Error("Unsupported earnings discovery input");
  const sourceId = sourceIdentity(source), ref = db.collection(EARNINGS_SOURCES).doc(sourceId);
  return db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data() as EarningsWork | undefined;
    if (previous && (previous.recordType !== "source" || previous.sourceId !== sourceId || previous.inputKind !== inputKind
      || previous.source.url !== source.url || previous.source.companyId !== source.companyId)) throw new Error("Persisted earnings source identity conflict");
    if (options.requireCanaryBounds && previous && ["queued", "processing"].includes(previous.status)
      && (previous.maxExhibits !== 5 || previous.forceChildren !== true)) throw new Error("Active earnings source is outside the bounded canary; inspect it before retrying");
    if (previous && (["queued", "processing"].includes(previous.status) || (!options.force && previous.nextCheckAtMs > now)
      || (options.force && options.parentDeliveryId && previous.parentDeliveryId === options.parentDeliveryId))) return { status: "existing" as const, sourceId };
    const firstSeenAt = previous?.firstSeenAt ?? source.firstSeenAt;
    const value: EarningsWork = { recordType: "source", source: { ...source, firstSeenAt }, sourceId, inputKind,
      generation: (previous?.generation ?? 0) + 1, status: "queued", publishPending: true, attempts: 0,
      firstSeenAt, lastObservedAt: new Date(now).toISOString(), nextCheckAtMs: 0, ...(options.parentCaptureId ? { parentCaptureId: options.parentCaptureId } : {}),
      ...(options.parentDeliveryId ? { parentDeliveryId: options.parentDeliveryId } : {}),
      ...(inputKind === "sec_filing" ? { maxExhibits: options.maxExhibits ?? 20, forceChildren: options.force === true } : {}) };
    earningsSourceEvent(sourceId, value.generation);
    tx.set(ref, clean(value));
    return { status: "queued" as const, sourceId };
  });
}
export async function publishEarningsOutbox(db: Firestore, publish: (event: EarningsSourceDiscovered) => Promise<string>, limit = 50, sourceIds?: string[]) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid earnings outbox budget");
  if (sourceIds && (sourceIds.length > limit || sourceIds.some(id => !/^earnings_source_[a-f0-9]{64}$/.test(id)))) throw new Error("Invalid scoped earnings outbox");
  const docs = sourceIds ? (await Promise.all([...new Set(sourceIds)].map(id => db.collection(EARNINGS_SOURCES).doc(id).get()))).filter(doc => doc.get("publishPending") === true)
    : (await db.collection(EARNINGS_SOURCES).where("publishPending", "==", true).orderBy(FieldPath.documentId()).limit(limit).get()).docs;
  let published = 0;
  for (const doc of docs) {
    const work = doc.data() as EarningsWork;
    if (work.recordType !== "source" || work.sourceId !== doc.id) throw new Error("Invalid earnings outbox source");
    const event = earningsSourceEvent(doc.id, work.generation);
    const messageId = await publish(event);
    if (!messageId) throw new Error("Earnings publication was not confirmed");
    await db.runTransaction(async tx => {
      const current = (await tx.get(doc.ref)).data() as EarningsWork | undefined;
      if (current?.generation !== event.generation) return;
      tx.set(doc.ref, { publishPending: false, publishedAt: new Date().toISOString(), messageId }, { merge: true });
    });
    published++;
  }
  return { published, limitReached: docs.length === limit };
}
export async function claimEarningsSource(db: Firestore, event: EarningsSourceDiscovered, owner: string, now = Date.now()) {
  const ref = db.collection(EARNINGS_SOURCES).doc(event.sourceId);
  return db.runTransaction(async tx => {
    const work = (await tx.get(ref)).data() as EarningsWork | undefined;
    if (!work || work.recordType !== "source" || work.sourceId !== event.sourceId) throw new Error("Earnings delivery has no durable source");
    validateSource(work.source);
    earningsSourceEvent(work.sourceId, work.generation);
    if (sourceIdentity(work.source) !== work.sourceId || !["sec_filing", "document"].includes(work.inputKind)
      || !["queued", "processing", "extracted", "expanded", "review_required", "skipped"].includes(work.status)
      || !Number.isSafeInteger(work.attempts) || work.attempts < 0) throw new Error("Invalid durable earnings source state");
    if (work.generation > event.generation || (work.generation === event.generation && !["queued", "processing"].includes(work.status))) return null;
    if (work.generation !== event.generation) throw new Error("Earnings generation not yet durable");
    if ((work.leaseUntilMs ?? 0) > now) throw new Error("Earnings source is busy");
    const claimed: EarningsWork = { ...work, status: "processing", leaseOwner: owner, leaseUntilMs: now + 10 * 60_000, attempts: work.attempts + 1 };
    tx.set(ref, claimed);
    return claimed;
  });
}
type Capture = Omit<RawEarningsDocument, "text"> & { recordType: "capture"; captureId: string; rawByteLength: number; textByteLength: number; rawChunks: string[]; textChunks: string[] };
export async function persistEarningsCapture(db: Firestore, document: RawEarningsDocument, bytes: Uint8Array) {
  validateSource(document.source);
  if (document.sourceId !== sourceIdentity(document.source) || !bytes.length || !document.text.length
    || document.completeness !== "full" || document.rawSha256 !== sha256(bytes) || document.textSha256 !== sha256(document.text)
    || bytes.length > MAX_BYTES || Buffer.byteLength(document.text) > MAX_BYTES) throw new Error("Invalid full earnings provenance");
  const persistBytes = async (kind: "raw" | "text", data: Uint8Array) => {
    const compressed = gzipSync(data), digest = sha256(data), ids: string[] = [];
    for (let offset = 0, index = 0; offset < compressed.length; offset += CHUNK_BYTES, index++) {
      const id = `chunk_${kind}_${digest}_${index}`, chunk = compressed.subarray(offset, offset + CHUNK_BYTES), ref = db.collection(EARNINGS_SOURCES).doc(id);
      await db.runTransaction(async tx => {
        const existing = (await tx.get(ref)).data();
        if (existing && (existing.chunkSha256 !== sha256(chunk) || existing.encoding !== "gzip")) throw new Error("Raw earnings chunk conflict");
        if (!existing) tx.set(ref, { recordType: "raw_chunk", encoding: "gzip", chunkSha256: sha256(chunk), bytes: chunk });
      });
      ids.push(id);
    }
    return ids;
  };
  const rawChunks = await persistBytes("raw", bytes), textChunks = await persistBytes("text", Buffer.from(document.text));
  const { text: _text, ...metadata } = document; void _text;
  const captureId = stableId("earnings_capture", [document.sourceId, document.rawSha256, document.textSha256]);
  const capture: Capture = { ...metadata, recordType: "capture", captureId, rawByteLength: bytes.length, textByteLength: Buffer.byteLength(document.text), rawChunks, textChunks };
  const ref = db.collection(EARNINGS_SOURCES).doc(captureId);
  await db.runTransaction(async tx => {
    const existing = (await tx.get(ref)).data() as Capture | undefined;
    if (existing && (existing.rawSha256 !== capture.rawSha256 || existing.textSha256 !== capture.textSha256)) throw new Error("Raw earnings manifest conflict");
    if (!existing) tx.set(ref, clean(capture));
  });
  return captureId;
}
export async function readEarningsCapture(db: Firestore, captureId: string) {
  if (!/^earnings_capture_[a-f0-9]{64}$/.test(captureId)) throw new Error("Invalid earnings capture identity");
  const capture = (await db.collection(EARNINGS_SOURCES).doc(captureId).get()).data() as Capture | undefined;
  if (!capture || capture.recordType !== "capture" || capture.captureId !== captureId) throw new Error("Missing earnings capture");
  validateSource(capture.source);
  if (sourceIdentity(capture.source) !== capture.sourceId || stableId("earnings_capture", [capture.sourceId, capture.rawSha256, capture.textSha256]) !== captureId || capture.completeness !== "full") throw new Error("Earnings capture identity mismatch");
  const restore = async (ids: string[], length: number, hash: string, kind: string) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 60 || length < 1 || length > MAX_BYTES) throw new Error("Invalid earnings chunk manifest");
    const chunks: Buffer[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] !== `chunk_${kind}_${hash}_${i}`) throw new Error("Earnings chunk ordering mismatch");
      const chunk = (await db.collection(EARNINGS_SOURCES).doc(ids[i]).get()).data();
      if (!chunk || chunk.recordType !== "raw_chunk" || chunk.encoding !== "gzip" || !(chunk.bytes instanceof Uint8Array)
        || chunk.bytes.length > CHUNK_BYTES || sha256(chunk.bytes) !== chunk.chunkSha256) throw new Error("Missing or corrupt earnings chunk");
      chunks.push(Buffer.from(chunk.bytes));
    }
    const bytes = gunzipSync(Buffer.concat(chunks), { maxOutputLength: MAX_BYTES });
    if (bytes.length !== length || sha256(bytes) !== hash) throw new Error("Earnings capture integrity failure");
    return bytes;
  };
  const raw = await restore(capture.rawChunks, capture.rawByteLength, capture.rawSha256, "raw");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await restore(capture.textChunks, capture.textByteLength, capture.textSha256, "text"));
  return { document: { source: capture.source, sourceId: capture.sourceId, rawSha256: capture.rawSha256, textSha256: capture.textSha256, text,
    mediaType: capture.mediaType, retrievedAt: capture.retrievedAt, textMethod: capture.textMethod, completeness: capture.completeness } as RawEarningsDocument, bytes: raw };
}
export async function completeEarningsSource(db: Firestore, work: EarningsWork, owner: string, result: {
  status: "extracted" | "expanded" | "review_required" | "skipped"; captureId?: string; record?: EarningsRecord; reason?: string;
}, now = Date.now()) {
  const sourceRef = db.collection(EARNINGS_SOURCES).doc(work.sourceId);
  return db.runTransaction(async tx => {
    const current = (await tx.get(sourceRef)).data() as EarningsWork | undefined;
    if (current?.generation !== work.generation || current.leaseOwner !== owner) throw new Error("Earnings processing lease lost");
    const record = result.record;
    if (record && result.status !== "extracted") throw new Error("Only validated extraction can persist earnings metrics");
    if (result.status === "extracted" && !record) throw new Error("Validated earnings record missing");
    let existing: EarningsRecord | undefined;
    let prior: EarningsRecord | undefined;
    if (record) {
      if (!result.captureId || record.sourceId !== work.sourceId || record.companyId !== work.source.companyId || record.completeness !== "full") throw new Error("Earnings record source mismatch");
      const capture = (await tx.get(db.collection(EARNINGS_SOURCES).doc(result.captureId))).data() as Capture | undefined;
      if (capture?.recordType !== "capture" || capture.sourceId !== record.sourceId || capture.rawSha256 !== record.rawSha256 || capture.textSha256 !== record.textSha256) throw new Error("Earnings record lacks durable provenance");
      if (Buffer.byteLength(canonicalJson(record)) > 700_000) throw new Error("Earnings record exceeds storage bound");
      existing = (await tx.get(db.collection(EARNINGS_RECORDS).doc(record.revisionId))).get("record") as EarningsRecord | undefined;
      const head = (await tx.get(db.collection(EARNINGS_RECORDS).doc(`head_${record.eventId}`))).data();
      if (head?.revisionId) prior = (await tx.get(db.collection(EARNINGS_RECORDS).doc(head.revisionId))).get("record") as EarningsRecord | undefined;
      const comparable = (r: EarningsRecord) => canonicalJson({ ...r, extractedAt: undefined, source: { ...r.source, firstSeenAt: undefined } });
      if (existing && comparable(existing) !== comparable(record)) throw new Error("Conflicting immutable earnings revision");
      if (prior && (prior.issuerId !== record.issuerId || canonicalJson(prior.period) !== canonicalJson(record.period) || prior.kind !== record.kind)) throw new Error("Earnings event identity conflict");
      if (record.supersedes) {
        const seen = new Set([record.eventId]); let predecessor: string | undefined = record.supersedes;
        for (let depth = 0; predecessor; depth++) {
          if (depth >= 32 || seen.has(predecessor)) throw new Error("Earnings correction cycle or excessive lineage");
          seen.add(predecessor);
          const predecessorHead = (await tx.get(db.collection(EARNINGS_RECORDS).doc(`head_${predecessor}`))).data();
          if (!predecessorHead?.revisionId) throw new Error("Earnings correction predecessor missing");
          const previous = (await tx.get(db.collection(EARNINGS_RECORDS).doc(predecessorHead.revisionId))).get("record") as EarningsRecord | undefined;
          if (!previous || previous.issuerId !== record.issuerId || previous.kind !== record.kind || canonicalJson(previous.period) !== canonicalJson(record.period)) throw new Error("Earnings correction period/issuer mismatch");
          const a = record.source.publishedAt, b = previous.source.publishedAt;
          if (a && b && ((a.precision === "second" && b.precision === "second" && Date.parse(a.value) < Date.parse(b.value))
            || (a.precision === "date" && b.precision === "date" && a.timezone === b.timezone && a.value < b.value))) throw new Error("Earnings correction predates original");
          predecessor = previous.supersedes;
        }
      }
    }
    // All transaction reads precede writes. Publish acknowledgement occurs only
    // after this atomic revision/head/source checkpoint has committed.
    if (record && !existing) tx.set(db.collection(EARNINGS_RECORDS).doc(record.revisionId), clean({ recordType: "revision", companyId: record.companyId, eventId: record.eventId, groupId: record.groupId, captureId: result.captureId, record, createdAt: new Date(now).toISOString() }));
    if (record && prior?.revisionId !== record.revisionId) tx.set(db.collection(EARNINGS_RECORDS).doc(`head_${record.eventId}`), { recordType: "head", revisionId: record.revisionId, previousRevisionId: prior?.revisionId ?? null, updatedAt: new Date(now).toISOString() });
    tx.set(sourceRef, clean({ status: result.status, publishPending: false, leaseOwner: null, leaseUntilMs: 0,
      processedRevision: process.env.GIT_SHA ?? "local",
      checkedAt: new Date(now).toISOString(), nextCheckAtMs: now + EARNINGS_RECHECK_MS,
      ...(result.captureId ? { captureId: result.captureId } : {}), ...(record ? { revisionId: record.revisionId } : {}),
      ...(result.reason ? { reason: result.reason.slice(0, 1000) } : {}) }), { merge: true });
    return { status: result.status, duplicate: Boolean(existing), revisionId: record?.revisionId ?? null };
  });
}
export async function releaseFailedEarningsSource(db: Firestore, work: EarningsWork, owner: string, reason: string, now = Date.now()) {
  const ref = db.collection(EARNINGS_SOURCES).doc(work.sourceId);
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as EarningsWork | undefined;
    if (current?.generation !== work.generation || current.leaseOwner !== owner) return;
    tx.set(ref, { status: "queued", leaseOwner: null, leaseUntilMs: 0, lastError: reason.slice(0, 1000), lastFailureAt: new Date(now).toISOString() }, { merge: true });
  });
}
