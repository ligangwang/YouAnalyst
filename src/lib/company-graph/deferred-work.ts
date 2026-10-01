import { randomUUID } from "node:crypto";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { parseSecFilingDiscovered, type SecFilingDiscovered } from "../sec-filings/event";

const PREFIX = "_graph_deferred_";
const PUBLISH_LEASE_MS = 30_000;
export type DeferredCompanyGraphFiling = { id: string; event: SecFilingDiscovered };
const deferredRef = (db: Firestore, event: SecFilingDiscovered) =>
  db.collection("company_research_runs").doc(`${PREFIX}${event.eventId}`);

function assertSameEvent(saved: unknown, event: SecFilingDiscovered) {
  if (JSON.stringify(parseSecFilingDiscovered(saved)) !== JSON.stringify(event)) {
    throw new Error("Deferred graph filing identity reused with different contents");
  }
}
/** The original filing remains durable before its exhausted-budget delivery is ACKed. */
export async function deferCompanyGraphFiling(event: SecFilingDiscovered, retryAtMs: number, db: Firestore, now = Date.now()) {
  event = parseSecFilingDiscovered(event);
  if (event.form !== "10-K") throw new Error("Only 10-K graph filings can be deferred");
  if (!Number.isSafeInteger(retryAtMs) || retryAtMs <= 0) throw new Error("Invalid graph budget retry time");
  const ref = deferredRef(db, event);
  await db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data();
    if (prior) {
      assertSameEvent(prior.event, event);
      if (prior.deferredStatus === "COMPLETED") return;
    }
    tx.set(ref, { event, deferredStatus: "PENDING", reason: "DAILY_BUDGET",
      nextAttemptAtMs: Math.max(retryAtMs, Number(prior?.nextAttemptAtMs) || 0),
      deferredAt: new Date(now).toISOString(), publishedAt: null,
      publishLeaseOwner: null, publishLeaseExpiresAtMs: 0, dispatchError: null }, { merge: true });
  });
}

/** Duplicate deliveries can ACK while the exact event is already held durably. */
export async function readCompanyGraphFilingDeferral(event: SecFilingDiscovered, db: Firestore, now = Date.now()) {
  const data = (await deferredRef(db, event).get()).data();
  if (!data) return null;
  assertSameEvent(data.event, event);
  if (data.deferredStatus === "PENDING" && Number(data.nextAttemptAtMs) > now) {
    return { status: "deferred" as const, retryAtMs: Number(data.nextAttemptAtMs) };
  }
  return null;
}

/** Completion receipt proves a subscriber reached the durable graph result. */
export async function recordCompanyGraphFilingReceipt(event: SecFilingDiscovered, runId: string, db: Firestore, now = Date.now()) {
  await db.collection("company_research_runs").doc(`_graph_filing_receipt_${event.eventId}`).set({
    completed: true, eventId: event.eventId, companyId: event.companyId,
    accessionNumber: event.accessionNumber, runId, updatedAt: new Date(now).toISOString(),
  }, { merge: true });
}

export async function completeCompanyGraphFilingDeferral(event: SecFilingDiscovered, db: Firestore, now = Date.now()) {
  const ref = deferredRef(db, event);
  await db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data();
    if (!prior) return;
    assertSameEvent(prior.event, event);
    tx.set(ref, { deferredStatus: "COMPLETED", completedAt: new Date(now).toISOString(),
      nextAttemptAtMs: 0, publishLeaseOwner: null, publishLeaseExpiresAtMs: 0 }, { merge: true });
  });
}

export async function listDeferredCompanyGraphFilings(limit: number, db: Firestore, now = Date.now(), preview = false) {
  const cursorRef = db.collection("company_research_runs").doc("_graph_deferred_dispatch_cursor");
  const saved = (await cursorRef.get()).data()?.cursor;
  let cursor = typeof saved === "string" && saved.startsWith(PREFIX) ? saved : null;
  const candidates: DeferredCompanyGraphFiling[] = [];
  const max = Math.max(1, Math.min(5, Math.trunc(limit)));
  // Only document-ID inequalities/order: no new composite index, no unbounded
  // collection scan, and a persisted cursor moves past not-yet-due records.
  for (let page = 0; page < 10 && candidates.length < max; page++) {
    let query = db.collection("company_research_runs")
      .where(FieldPath.documentId(), ">=", `${PREFIX}sec_`)
      .where(FieldPath.documentId(), "<", `${PREFIX}sec_\uf8ff`)
      .orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      cursor = doc.id;
      const data = doc.data();
      if (data.deferredStatus === "PENDING" && Number(data.nextAttemptAtMs) <= now
        && Number(data.publishLeaseExpiresAtMs ?? 0) <= now) {
        const event = parseSecFilingDiscovered(data.event);
        if (doc.id !== `${PREFIX}${event.eventId}` || event.form !== "10-K") throw new Error("Invalid deferred graph filing record");
        candidates.push({ id: doc.id, event });
      }
      if (candidates.length >= max) break;
    }
    if (snapshot.docs.length < 100 && candidates.length < max) { cursor = null; break; }
  }
  if (!preview) await cursorRef.set({ cursor }, { merge: true });
  return candidates;
}

export async function dispatchDeferredCompanyGraphFiling(event: SecFilingDiscovered, db: Firestore,
  publish: (event: SecFilingDiscovered) => Promise<unknown>, now = Date.now()) {
  event = parseSecFilingDiscovered(event);
  const ref = deferredRef(db, event), owner = randomUUID();
  const reserved = await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (!data) return false;
    assertSameEvent(data.event, event);
    if (data.deferredStatus !== "PENDING" || Number(data.nextAttemptAtMs) > now
      || Number(data.publishLeaseExpiresAtMs) > now) return false;
    tx.set(ref, { publishLeaseOwner: owner, publishLeaseExpiresAtMs: now + PUBLISH_LEASE_MS }, { merge: true });
    return true;
  });
  if (!reserved) return { status: "PENDING" as const };
  try {
    await publish(event);
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      // The subscriber may already have completed or deferred to another day.
      if (data?.publishLeaseOwner === owner && data.deferredStatus === "PENDING") tx.set(ref, {
        deferredStatus: "PUBLISHED", publishedAt: new Date(now).toISOString(), dispatchError: null,
        publishLeaseOwner: null, publishLeaseExpiresAtMs: 0,
      }, { merge: true });
    });
    return { status: "PUBLISHED" as const };
  } catch (error) {
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if (data?.publishLeaseOwner === owner && data.deferredStatus === "PENDING") tx.set(ref, {
        dispatchError: error instanceof Error ? error.message : "Publication failed",
        publishLeaseOwner: null, publishLeaseExpiresAtMs: 0, nextAttemptAtMs: now + 60_000,
      }, { merge: true });
    });
    throw error;
  }
}
