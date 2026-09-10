import { type EventFilter } from "./filters";
import { FieldPath, type Firestore, type Query, type QuerySnapshot } from "firebase-admin/firestore";
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

export async function listPublicEvents(input: { limit?: number; cursor?: EventCursor; type?: EventFilter } = {}, db = getAdminFirestore()) {
  const limit = Math.max(1, Math.min(MAX_EVENT_PAGE_SIZE, Math.trunc(input.limit ?? EVENT_PAGE_SIZE)));
  // The shared collection is public-only. Private calls never enter this store.
  let query = publicEventsQuery(input.type ?? "all", db);
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

function publicEventsQuery(type: EventFilter, db: Firestore): Query {
  let query: Query = db.collection("events");
  if (type !== "all") query = query.where("type", "==", type);
  return query.orderBy("publishedAt", "desc").orderBy(FieldPath.documentId(), "desc");
}

type Viewer = { next: (page: PublicEventPage) => void; error: () => void };
type Hub = { viewers: Set<Viewer>; stop: (() => void) | null; latest: PublicEventPage | null };
/** One bounded listener per active filter, shared by viewers on this server. */
const hubs = new Map<EventFilter, Hub>();

export function subscribePublicEvents(next: Viewer["next"], error: Viewer["error"], type: EventFilter = "all", db = getAdminFirestore()): () => void {
  let hub = hubs.get(type);
  if (!hub) { hub = { viewers: new Set(), stop: null, latest: null }; hubs.set(type, hub); }
  const currentHub = hub;
  const viewer = { next, error };
  currentHub.viewers.add(viewer);
  if (currentHub.latest) next(currentHub.latest);
  if (!currentHub.stop) {
    try {
      currentHub.stop = publicEventsQuery(type, db).limit(EVENT_PAGE_SIZE + 1).onSnapshot(snapshot => {
        currentHub.latest = publicEventPage(snapshot, EVENT_PAGE_SIZE);
        for (const current of [...currentHub.viewers]) current.next(currentHub.latest);
      }, () => {
        currentHub.stop?.(); currentHub.stop = null; currentHub.latest = null;
        if (hubs.get(type) === currentHub) hubs.delete(type);
        for (const current of [...currentHub.viewers]) current.error();
      });
    } catch (cause) {
      currentHub.viewers.delete(viewer);
      if (!currentHub.viewers.size && hubs.get(type) === currentHub) hubs.delete(type);
      throw cause;
    }
  }
  return () => {
    currentHub.viewers.delete(viewer);
    if (!currentHub.viewers.size) {
      currentHub.stop?.(); currentHub.stop = null; currentHub.latest = null;
      if (hubs.get(type) === currentHub) hubs.delete(type);
    }
  };
}
