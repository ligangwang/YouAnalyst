import type { SecFiling } from "./source";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { isSecFilingDate, parseSecFilingDiscovered, type SecFilingDiscovered } from "./event";

export const SEC_FILINGS_COLLECTION = "sec_filings";
export const SEC_COLLECTOR_METADATA_COLLECTION = "company_fundamentals";
export const SEC_COLLECTOR_METADATA_DOCUMENT = "_sec_filings_collector";
export type SecCollectorScan = {
  startedAt: string;
  fromDate: string;
  baseline: boolean;
  completedArchives: string[];
  baselineFilings: SecFiling[] | null;
};
export type SecCollectorCursor = {
  version: 1;
  cik: string;
  baselineAt: string;
  lastCompleteAt: string | null;
  nextPollAfterMs: number;
  scan: SecCollectorScan | null;
};
export type SecFilingDiscoveryRecord = {
  event: SecFilingDiscovered;
  state: "baseline" | "pending" | "published";
  publishedAt?: string;
  messageId?: string;
};
type Discoveries = Record<string, SecFilingDiscoveryRecord>;

/** Baselines are history, not new activity. Keep the original observation time. */
export function firstIntelligenceObservation(records:Discoveries):string|null {
  const times=Object.values(records).filter(record=>record.state==='pending'||record.state==='published').map(record=>parseSecFilingDiscovered(record.event).discoveredAt);
  return times.sort()[0]??null;
}

export function secCollectorMetadata(db: Firestore) {
  return db.collection(SEC_COLLECTOR_METADATA_COLLECTION).doc(SEC_COLLECTOR_METADATA_DOCUMENT);
}
export async function readSecCollectorCursor(db: Firestore, companyId: string): Promise<SecCollectorCursor | null> {
  const value = (await db.collection(SEC_COLLECTOR_METADATA_COLLECTION).doc(companyId).get()).get("secFilingsCollector");
  if (!value) return null;
  if (value.version !== 1 || !/^\d{10}$/.test(value.cik) || !Number.isFinite(Date.parse(value.baselineAt))
    || (value.lastCompleteAt !== null && !Number.isFinite(Date.parse(value.lastCompleteAt)))
    || !Number.isFinite(value.nextPollAfterMs)
    || (value.scan !== null && (!value.scan || !Array.isArray(value.scan.completedArchives)
      || !value.scan.completedArchives.every((name: unknown) => typeof name === "string")
      || !Number.isFinite(Date.parse(value.scan.startedAt)) || !isSecFilingDate(value.scan.fromDate)
      || typeof value.scan.baseline !== "boolean"
      || (value.scan.baselineFilings !== null && (!Array.isArray(value.scan.baselineFilings) || value.scan.baselineFilings.length > 2000))))) throw new Error(`Invalid SEC filing cursor for ${companyId}`);
  return value as SecCollectorCursor;
}
export async function writeSecCollectorCursor(db: Firestore, companyId: string, value: SecCollectorCursor) {
  await db.collection(SEC_COLLECTOR_METADATA_COLLECTION).doc(companyId).set({ secFilingsCollector: value }, { merge: true });
}

/** Existing accession documents also contain graph extraction results; always merge. */
export async function persistSecFilingDiscovery(db: Firestore, event: SecFilingDiscovered, baseline: boolean) {
  event = parseSecFilingDiscovered(event);
  const ref = db.collection(SEC_FILINGS_COLLECTION).doc(event.accessionNumber);
  return db.runTransaction(async tx => {
    const stored = (await tx.get(ref)).data();
    const records = (stored?.discoveryEvents ?? {}) as Discoveries;
    const existing = records[event.eventId];
    if (existing) {
      const saved = parseSecFilingDiscovered(existing.event);
      // Preserve the originally persisted discoveredAt through all retries.
      if (["companyId", "cik", "accessionNumber", "form", "filingDate", "primaryDocument", "isXbrl"].some(key =>
        saved[key as keyof SecFilingDiscovered] !== event[key as keyof SecFilingDiscovered])) {
        throw new Error("SEC filing event metadata conflicts with the persisted accession");
      }
      if (!["baseline", "pending", "published"].includes(existing.state)) throw new Error("Invalid SEC discovery state");
      const observedAt=firstIntelligenceObservation(records);
      if(observedAt&&stored?.intelligenceObservedAt!==observedAt)tx.set(ref,{intelligenceObservedAt:observedAt},{merge:true});
      return "existing" as const;
    }
    for (const record of Object.values(records)) {
      const saved = parseSecFilingDiscovered(record.event);
      if (["cik", "accessionNumber", "form", "filingDate", "primaryDocument", "isXbrl"].some(key =>
        saved[key as keyof SecFilingDiscovered] !== event[key as keyof SecFilingDiscovered])) {
        throw new Error("SEC filing metadata conflicts across listings of the same accession");
      }
    }
    for (const key of ["cik", "form", "filingDate", "primaryDocument"] as const) {
      if (stored?.[key] !== undefined && stored[key] !== event[key]) throw new Error("SEC filing metadata conflicts with the existing accession");
    }
    const state = baseline ? "baseline" : "pending";
    const observedAt=firstIntelligenceObservation({...records,[event.eventId]:{event,state}});
    tx.set(ref, {
      accessionNumber: event.accessionNumber, cik: event.cik, ticker: stored?.ticker ?? event.companyId,
      form: event.form, filingDate: event.filingDate, primaryDocument: event.primaryDocument,
      published_at: event.published_at??null,
      collected_at: stored?.collected_at??event.discoveredAt,
      processed_at: stored?.processed_at??new Date().toISOString(),
      discoveryEvents: { [event.eventId]: { event, state } },
      discoveryPending: !baseline || stored?.discoveryPending === true,
      ...(observedAt?{intelligenceObservedAt:observedAt}:{}),
    }, { merge: true });
    return state;
  });
}

export async function listPendingSecFilings(db: Firestore, after?: string, limit = 100) {
  let query = db.collection(SEC_FILINGS_COLLECTION).where("discoveryPending", "==", true)
    .orderBy(FieldPath.documentId()).limit(limit);
  if (after) query = query.startAfter(after);
  const page = await query.get();
  return page.docs.map(doc => {
    const events = Object.entries((doc.get("discoveryEvents") ?? {}) as Discoveries)
      .filter(([, record]) => record.state === "pending").map(([id, record]) => {
        const event = parseSecFilingDiscovered(record.event);
        if (id !== event.eventId || event.accessionNumber !== doc.id) throw new Error("SEC filing outbox identity conflicts with document");
        return event;
      });
    if (!events.length) throw new Error("SEC filing marked pending without an outbox event");
    return { accessionNumber: doc.id, events };
  });
}
export async function markSecFilingPublished(db: Firestore, event: SecFilingDiscovered, publishedAt: string, messageId: string) {
  const ref = db.collection(SEC_FILINGS_COLLECTION).doc(event.accessionNumber);
  await db.runTransaction(async tx => {
    const records = ((await tx.get(ref)).get("discoveryEvents") ?? {}) as Discoveries;
    if (records[event.eventId]?.state !== "pending") throw new Error("SEC filing outbox changed before publish checkpoint");
    tx.set(ref, {
      discoveryEvents: { [event.eventId]: { state: "published", publishedAt, messageId } },
      discoveryPending: Object.entries(records).some(([id, record]) => id !== event.eventId && record.state === "pending"),
    }, { merge: true });
  });
}
