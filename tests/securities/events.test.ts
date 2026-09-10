import assert from "node:assert/strict";
import test from "node:test";
import { filingEvent, publicEventFromDocument, type FilingEventInput } from "../../src/lib/events/model";
import { decodeEventCursor, encodeEventCursor, publishFilingEvent } from "../../src/lib/events/service";
import type { Firestore } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/events/route";

const input: FilingEventInput = { type: "SEC_FORM4", accessionNumber: "0001234567-26-000001", filingDate: "2026-09-08", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1234567/filing.txt", entityName: "Example", tickers: ["amd", "AMD", "", "../private"], amended: false };
const now = "2026-09-10T12:00:00.000Z";

test("filings have stable identity, normalized tickers, and distinct filing and publication dates", () => {
  const event = filingEvent(input, now);
  assert.deepEqual(event.tickers, ["AMD"]);
  assert.equal(event.occurredAt, "2026-09-08");
  assert.equal(event.publishedAt, now);
  assert.equal(filingEvent(input, "2026-09-11T12:00:00.000Z").id, event.id);
  assert.notEqual(filingEvent({ ...input, accessionNumber: "0001234567-26-000002", amended: true }, now).id, event.id);
  assert.match(filingEvent({ ...input, type: "SEC_13F" }, now).summary, /not current trades/);
});

test("rejects unsafe source links, invalid filing dates and malformed identities", () => {
  for (const sourceUrl of ["javascript:alert(1)", "https://www.sec.gov.evil.test/Archives/x", "http://www.sec.gov/Archives/x", "https://www.sec.gov/search", "https://user@www.sec.gov/Archives/x"]) assert.throws(() => filingEvent({ ...input, sourceUrl }, now));
  for (const filingDate of ["2026-02-30", "yesterday", "2026-09-10T12:00:00Z"]) assert.throws(() => filingEvent({ ...input, filingDate }, now));
  assert.throws(() => filingEvent({ ...input, accessionNumber: "../private" }, now));
});

test("public projection fails closed and never includes extra document fields", () => {
  const event = filingEvent(input, now);
  assert.deepEqual(publicEventFromDocument(event.id, { ...event, privateThesis: "never expose", userId: "owner" }), event);
  assert.equal(publicEventFromDocument(event.id, { ...event, visibility: "PRIVATE" }), null);
  assert.equal(publicEventFromDocument(event.id, { ...event, schemaVersion: 2 }), null);
  assert.equal(publicEventFromDocument("wrong-id", event), null);
});

test("pagination cursors preserve timestamp ties and reject malformed input", () => {
  const cursor = { publishedAt: now, id: filingEvent(input, now).id };
  assert.deepEqual(decodeEventCursor(encodeEventCursor(cursor)), cursor);
  for (const value of ["", "broken", "x".repeat(513), encodeEventCursor({ ...cursor, id: "../private" }), encodeEventCursor({ ...cursor, publishedAt: "yesterday" })]) assert.throws(() => decodeEventCursor(value));
});

test("reprocessing replaces facts without duplicating the event or changing its publication time", async () => {
  const documents = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (name: string) => { assert.equal(name, "events"); return { doc: (id: string) => ({ id }) }; },
    runTransaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      get: async (ref: { id: string }) => ({ exists: documents.has(ref.id), data: () => documents.get(ref.id) }),
      set: (ref: { id: string }, data: Record<string, unknown>) => documents.set(ref.id, data),
    }),
  } as unknown as Firestore;
  await publishFilingEvent(input, { db, now: () => now });
  const later = "2026-09-11T12:00:00.000Z";
  await publishFilingEvent({ ...input, entityName: "Corrected company name" }, { db, now: () => later });
  assert.equal(documents.size, 1);
  const event = documents.get(filingEvent(input, now).id)!;
  assert.equal(event.publishedAt, now);
  assert.equal(event.updatedAt, later);
  assert.match(event.title as string, /Corrected company name/);
  db.runTransaction = async () => { throw new Error("Write failed"); };
  await assert.rejects(publishFilingEvent(input, { db }), /Write failed/);
});

test("read API rejects invalid bounds and cursors before accessing storage", async () => {
  for (const params of ["limit=0", "limit=51", "limit=-1", "limit=1.5", "limit=NaN", "cursor=broken", "cursor="]) {
    const response = await GET(new NextRequest(`https://youanalyst.com/api/events?${params}`));
    assert.equal(response.status, 400);
  }
});
