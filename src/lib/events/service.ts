import { FieldPath, type Firestore, type QuerySnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE, filingEvent, isEventTimestamp, publicEventFromDocument, type FilingEventInput } from "./model";

export type EventCursor = { publishedAt: string; id: string };

export function decodeEventCursor(value: string): EventCursor {
  try {
    if (value.length > 512) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EventCursor;
    if (typeof parsed.publishedAt !== "string" || !isEventTimestamp(parsed.publishedAt) || typeof parsed.id !== "string" || !/^sec_(form4|13f)-\d{10}-\d{2}-\d{6}$/.test(parsed.id)) throw new Error();
    return { publishedAt: parsed.publishedAt, id: parsed.id };
  } catch { throw new Error("Invalid event cursor"); }
}

export function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Reprocessing updates source facts but preserves the original feed position. */
export async function publishFilingEvent(input: FilingEventInput, dependencies: { db?: Firestore; now?: () => string } = {}): Promise<void> {
  const db = dependencies.db ?? getAdminFirestore();
  const event = filingEvent(input, dependencies.now?.() ?? new Date().toISOString());
  const ref = db.collection("events").doc(event.id);
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    const previous = existing.exists ? publicEventFromDocument(ref.id, existing.data()!) : null;
    tx.set(ref, { ...event, publishedAt: previous?.publishedAt ?? event.publishedAt });
  });
}

export async function listPublicEvents(input: { limit?: number; cursor?: EventCursor } = {}) {
  const limit = Math.max(1, Math.min(MAX_EVENT_PAGE_SIZE, Math.trunc(input.limit ?? EVENT_PAGE_SIZE)));
  // The shared collection is public-only. Private calls never enter this store.
  let query = getAdminFirestore().collection("events").orderBy("publishedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (input.cursor) query = query.startAfter(input.cursor.publishedAt, input.cursor.id);
  const snapshot = await query.limit(limit + 1).get();
  return publicEventPage(snapshot, limit);
}

function publicEventPage(snapshot: QuerySnapshot, limit: number) {
  const page = snapshot.docs.slice(0, limit);
  const items = page.flatMap(doc => { const event = publicEventFromDocument(doc.id, doc.data()); return event ? [event] : []; });
  const last = page.at(-1);
  const nextCursor = snapshot.size > limit && last ? encodeEventCursor({ publishedAt: last.get("publishedAt"), id: last.id }) : null;
  return { items, nextCursor };
}

export type PublicEventPage = Awaited<ReturnType<typeof listPublicEvents>>;

/** One bounded Firestore listener per active server instance, shared by its viewers. */
const viewers = new Set<{ next: (page: PublicEventPage) => void; error: () => void }>();
let stopWatching: (() => void) | null = null;
let latestPage: PublicEventPage | null = null;

export function subscribePublicEvents(next: (page: PublicEventPage) => void, error: () => void): () => void {
  const viewer = { next, error };
  viewers.add(viewer);
  if (latestPage) next(latestPage);
  if (!stopWatching) {
    try {
    stopWatching = getAdminFirestore().collection("events").orderBy("publishedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc").limit(EVENT_PAGE_SIZE + 1).onSnapshot(snapshot => {
        latestPage = publicEventPage(snapshot, EVENT_PAGE_SIZE);
        for (const current of [...viewers]) current.next(latestPage);
      }, () => {
        latestPage = null;
        stopWatching?.(); stopWatching = null;
        for (const current of [...viewers]) current.error();
      });
    } catch (cause) {
      viewers.delete(viewer);
      throw cause;
    }
  }
  return () => {
    viewers.delete(viewer);
    if (!viewers.size) { stopWatching?.(); stopWatching = null; latestPage = null; }
  };
}
